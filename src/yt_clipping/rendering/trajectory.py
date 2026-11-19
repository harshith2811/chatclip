"""
1D Kinematic Camera Trajectory Optimizer (AutoFlip-inspired).
Enforces viewport boundaries, velocity limits, acceleration ramps,
and deadband hysteresis across scene shot segments.
"""

from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict, Any, Sequence
import math
import numpy as np

try:
    from scipy.linalg import solveh_banded
except ImportError:
    solveh_banded = None


@dataclass
class TrajectoryConfig:
    canvas_width: int = 1920
    canvas_height: int = 1080
    crop_width: int = 608
    crop_height: int = 1080
    fps: float = 30.0
    max_velocity: float = 450.0          # Max panning speed (px/sec)
    max_acceleration: float = 750.0      # Max panning acceleration (px/sec^2)
    deadband_px: float = 24.0            # Micro-jitter deadband threshold (px)
    scene_cut_threshold: float = 0.35    # Normalized width jump to trigger shot reset
    smoothing_lambda_v: float = 0.10     # Velocity regularization weight
    smoothing_lambda_a: float = 0.05     # Acceleration/jerk regularization weight
    solver_mode: str = "hybrid"          # "hybrid" | "kinematic" | "convex"


@dataclass
class KinematicSegment:
    start_time: float
    end_time: float
    start_crop_x: int
    end_crop_x: int
    mode: str                           # "hold" | "pan" | "cut"
    max_velocity: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TrajectoryResult:
    raw_centers: np.ndarray             # (T,) raw detections
    smoothed_centers: np.ndarray        # (T,) smoothed centers in [c_min, c_max]
    smoothed_crop_x: np.ndarray         # (T,) even integers in [0, W - crop_w]
    timestamps: np.ndarray              # (T,) timestamps in seconds
    scene_cuts: List[float]             # Detected cut timestamps
    segments: List[KinematicSegment]     # Semantic camera actions (hold, pan, cut)
    ffmpeg_crop_filter: str             # libavfilter crop expression
    max_observed_velocity: float        # Observed max velocity (px/sec)
    max_observed_acceleration: float    # Observed max acceleration (px/sec^2)
    is_dynamic_pan: bool                # True if camera executes panning motion

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_centers": self.raw_centers.tolist(),
            "smoothed_centers": self.smoothed_centers.tolist(),
            "smoothed_crop_x": self.smoothed_crop_x.tolist(),
            "timestamps": self.timestamps.tolist(),
            "scene_cuts": self.scene_cuts,
            "segments": [s.to_dict() for s in self.segments],
            "ffmpeg_crop_filter": self.ffmpeg_crop_filter,
            "max_observed_velocity": self.max_observed_velocity,
            "max_observed_acceleration": self.max_observed_acceleration,
            "is_dynamic_pan": self.is_dynamic_pan,
        }


class ConstrainedTrajectoryOptimizer:
    """
    AutoFlip-inspired 1D kinematic camera trajectory optimizer.
    Enforces viewport boundaries, velocity limits, acceleration ramps,
    and deadband hysteresis across scene shot segments.
    """

    def __init__(self, config: Optional[TrajectoryConfig] = None):
        self.config = config or TrajectoryConfig()

    def optimize(
        self,
        raw_centers: Sequence[Optional[float]],
        timestamps: Optional[Sequence[float]] = None,
        weights: Optional[Sequence[float]] = None,
        scene_cuts: Optional[Sequence[float]] = None,
        canvas_width: Optional[int] = None,
        crop_width: Optional[int] = None,
        crop_height: Optional[int] = None,
        fps: Optional[float] = None,
    ) -> TrajectoryResult:
        """Optimizes a 1D sequence of camera focal centers under kinematic constraints."""
        canvas_w = int(canvas_width or self.config.canvas_width)
        crop_w = int(crop_width or self.config.crop_width)
        crop_h = int(crop_height or self.config.crop_height)
        fps_val = float(fps or self.config.fps)
        dt = 1.0 / max(fps_val, 1e-4)
        c_min, c_max = crop_w / 2.0, canvas_w - crop_w / 2.0
        c_mid = canvas_w / 2.0
        x_mid = int(canvas_w - crop_w) // 2
        if x_mid % 2 != 0:
            x_mid = max(0, x_mid - 1)

        if len(raw_centers) == 0:
            default_c = np.array([c_mid], dtype=np.float64)
            default_x = np.array([x_mid], dtype=int)
            default_t = np.array([0.0], dtype=np.float64)
            seg = KinematicSegment(start_time=0.0, end_time=0.0, start_crop_x=x_mid, end_crop_x=x_mid, mode="hold")
            return TrajectoryResult(
                raw_centers=default_c, smoothed_centers=default_c, smoothed_crop_x=default_x,
                timestamps=default_t, scene_cuts=[], segments=[seg],
                ffmpeg_crop_filter=f"crop={crop_w}:{crop_h}:{x_mid}:0",
                max_observed_velocity=0.0, max_observed_acceleration=0.0, is_dynamic_pan=False,
            )

        # Convert raw centers to float array with np.nan for None, non-finite, or invalid types
        sanitized_centers = []
        for c in raw_centers:
            if c is None:
                sanitized_centers.append(np.nan)
            else:
                try:
                    val = float(c)
                    sanitized_centers.append(val if np.isfinite(val) else np.nan)
                except (ValueError, TypeError):
                    sanitized_centers.append(np.nan)
        raw_arr = np.array(sanitized_centers, dtype=np.float64)
        T = len(raw_arr)

        if timestamps is None:
            ts = np.arange(T, dtype=np.float64) * dt
        else:
            ts = np.array(timestamps, dtype=np.float64)
            if len(ts) != T:
                ts = np.arange(T, dtype=np.float64) * dt

        # Impute missing centers
        imputed = self._impute_missing_centers(raw_arr, canvas_w)

        # Partition into contiguous shots
        cut_ts_list = list(scene_cuts) if scene_cuts else []
        shots = self._partition_into_shots(imputed, ts, cut_ts_list, canvas_w)

        # Process each shot independently to strictly prevent panning across cuts
        smoothed_centers = np.zeros(T, dtype=np.float64)
        solver_mode = self.config.solver_mode.lower()

        for s_idx, e_idx in shots:
            shot_targets = imputed[s_idx : e_idx + 1]
            shot_len = len(shot_targets)
            if shot_len == 1:
                smoothed_centers[s_idx] = np.clip(shot_targets[0], c_min, c_max)
                continue

            # 1. Apply deadband hysteresis to suppress micro-jitter
            db_targets = self._apply_deadband(shot_targets, self.config.deadband_px)

            # 2. Smooth trajectory
            shot_weights = None
            if weights is not None:
                if len(weights) == T:
                    shot_weights = weights[s_idx : e_idx + 1]
                elif len(weights) == shot_len:
                    shot_weights = weights

            if solver_mode == "convex":
                sc = self._solve_convex_banded(
                    db_targets, dt, shot_weights, self.config.smoothing_lambda_v, self.config.smoothing_lambda_a
                )
                sc = np.clip(sc, c_min, c_max)
            elif solver_mode == "kinematic":
                sc = self._apply_kinematic_forward_backward(
                    db_targets, dt, self.config.max_velocity, self.config.max_acceleration, c_min, c_max
                )
            else:  # "hybrid" default
                convex_c = self._solve_convex_banded(
                    db_targets, dt, shot_weights, self.config.smoothing_lambda_v, self.config.smoothing_lambda_a
                )
                sc = self._apply_kinematic_forward_backward(
                    convex_c, dt, self.config.max_velocity, self.config.max_acceleration, c_min, c_max
                )

            smoothed_centers[s_idx : e_idx + 1] = sc

        # Ensure bounds on all smoothed centers
        smoothed_centers = np.clip(smoothed_centers, c_min, c_max)

        # Convert centers to even crop X coordinates
        raw_crop_x = np.round(smoothed_centers - crop_w / 2.0).astype(int)
        raw_crop_x = np.clip(raw_crop_x, 0, canvas_w - crop_w)
        smoothed_crop_x = raw_crop_x - (raw_crop_x % 2)

        # Calculate observed kinematics (excluding shot cut boundaries)
        cut_start_indices = {s for s, e in shots if s > 0}
        max_obs_v = 0.0
        max_obs_a = 0.0

        if T >= 2:
            dts = np.maximum(np.diff(ts), 1e-4)
            diffs = np.diff(smoothed_centers)
            vels = np.abs(diffs) / dts
            for s in cut_start_indices:
                if 0 <= s - 1 < len(vels):
                    vels[s - 1] = 0.0
            max_obs_v = float(np.max(vels)) if len(vels) > 0 else 0.0

            if len(vels) >= 2:
                acc_diffs = np.diff(vels)
                accs = np.abs(acc_diffs) / dts[:-1]
                for s in cut_start_indices:
                    if 0 <= s - 2 < len(accs):
                        accs[s - 2] = 0.0
                    if 0 <= s - 1 < len(accs):
                        accs[s - 1] = 0.0
                max_obs_a = float(np.max(accs)) if len(accs) > 0 else 0.0

        # Decompose into cinematic segments
        segments = self._decompose_segments(smoothed_crop_x, ts, shots, dt)

        # Build FFmpeg crop filter
        ffmpeg_filter, is_dynamic = self._build_ffmpeg_crop_expression(
            crop_w, crop_h, smoothed_crop_x, ts, shots, segments, canvas_w
        )

        return TrajectoryResult(
            raw_centers=raw_arr, smoothed_centers=smoothed_centers, smoothed_crop_x=smoothed_crop_x,
            timestamps=ts, scene_cuts=cut_ts_list, segments=segments, ffmpeg_crop_filter=ffmpeg_filter,
            max_observed_velocity=round(max_obs_v, 2), max_observed_acceleration=round(max_obs_a, 2),
            is_dynamic_pan=is_dynamic,
        )

    def _impute_missing_centers(self, raw: np.ndarray, canvas_w: float) -> np.ndarray:
        """Interpolates missing/dropped face detections across time, anchoring undefined boundaries to center."""
        c_mid = canvas_w / 2.0
        finite_mask = np.isfinite(raw)
        if not np.any(finite_mask):
            return np.full_like(raw, c_mid)
        if np.all(finite_mask):
            return raw.copy()

        finite_indices = np.where(finite_mask)[0]
        first_idx = int(finite_indices[0])
        last_idx = int(finite_indices[-1])

        extended_indices = [int(i) for i in finite_indices]
        extended_values = [float(v) for v in raw[finite_mask]]

        # If clip starts without a valid face, anchor index 0 at center
        # so video never starts with an extreme left/right edge crop
        if first_idx > 0:
            extended_indices.insert(0, 0)
            # If first face is detected within first 3 samples, blend softly; otherwise start at center
            start_val = c_mid if first_idx > 3 else (0.7 * c_mid + 0.3 * raw[first_idx])
            extended_values.insert(0, start_val)

        if last_idx < len(raw) - 1:
            extended_indices.append(len(raw) - 1)
            end_val = c_mid if (len(raw) - 1 - last_idx) > 5 else raw[last_idx]
            extended_values.append(end_val)

        indices = np.arange(len(raw))
        imputed = np.interp(indices, np.array(extended_indices, dtype=float), np.array(extended_values, dtype=float))
        return imputed

    def _partition_into_shots(
        self,
        centers: np.ndarray,
        timestamps: np.ndarray,
        scene_cuts: List[float],
        canvas_w: float,
    ) -> List[Tuple[int, int]]:
        """Partitions sequence into continuous shots severed by cuts or large displacement jumps."""
        T = len(centers)
        if T <= 1:
            return [(0, T - 1)]

        jump_thresh = self.config.scene_cut_threshold * canvas_w
        shots: List[Tuple[int, int]] = []
        shot_start = 0

        for i in range(1, T):
            is_cut = False
            t_curr = timestamps[i]
            t_prev = timestamps[i - 1]

            # 1. External scene cut
            if any(t_prev < c <= t_curr for c in scene_cuts):
                is_cut = True
            # 2. Large spatial jump
            elif abs(centers[i] - centers[i - 1]) > jump_thresh:
                is_cut = True
            # 3. Temporal gap
            elif (t_curr - t_prev) > 1.0:
                is_cut = True

            if is_cut:
                shots.append((shot_start, i - 1))
                shot_start = i

        shots.append((shot_start, T - 1))
        return shots

    def _apply_deadband(self, targets: np.ndarray, deadband_px: float) -> np.ndarray:
        """Hysteresis deadband filter to eliminate micro-jitter and small head movements."""
        if deadband_px <= 0.0 or len(targets) <= 1:
            return targets.copy()

        out = np.zeros_like(targets)
        anchor = targets[0]
        out[0] = anchor

        for t in range(1, len(targets)):
            delta = targets[t] - anchor
            if abs(delta) <= deadband_px:
                out[t] = anchor
            else:
                anchor = targets[t] - np.sign(delta) * deadband_px
                out[t] = anchor

        return out

    def _solve_convex_banded(
        self,
        p: np.ndarray,
        dt: float,
        weights: Optional[Sequence[float]],
        lambda_v: float,
        lambda_a: float,
    ) -> np.ndarray:
        """Solves the pentadiagonal regularized quadratic smoothing system Ax = Wp in O(T) time."""
        T = len(p)
        if T <= 2:
            return p.copy()

        kv = lambda_v / max(dt ** 2, 1e-6)
        ka = lambda_a / max(dt ** 4, 1e-10)

        # Diagonals for banded format
        # ab shape: (3, T)
        # ab[2, :] = main diagonal
        # ab[1, 1:] = 1st superdiagonal
        # ab[0, 2:] = 2nd superdiagonal
        ab = np.zeros((3, T), dtype=np.float64)

        # Main diagonal
        ab[2, :] = 1.0 + 2.0 * kv + 6.0 * ka
        ab[2, 0] = 1.0 + kv + ka
        ab[2, -1] = 1.0 + kv + ka
        if T > 2:
            ab[2, 1] = 1.0 + 2.0 * kv + 5.0 * ka
            ab[2, -2] = 1.0 + 2.0 * kv + 5.0 * ka

        # 1st superdiagonal
        ab[1, 1:] = -kv - 4.0 * ka
        if T > 2:
            ab[1, 1] = -kv - 2.0 * ka
            ab[1, -1] = -kv - 2.0 * ka

        # 2nd superdiagonal
        if T > 2:
            ab[0, 2:] = ka

        # Weight modulation if provided
        if weights is not None and len(weights) == T:
            w_arr = np.array(weights, dtype=np.float64)
            ab[2, :] += (w_arr - 1.0)
            b = w_arr * p
        else:
            b = p.copy()

        if solveh_banded is not None:
            try:
                return solveh_banded(ab, b, lower=False)
            except Exception:
                pass

        # Fallback to dense symmetric banded linear solve
        A = np.zeros((T, T), dtype=np.float64)
        for i in range(T):
            A[i, i] = ab[2, i]
            if i + 1 < T:
                A[i, i + 1] = ab[1, i + 1]
                A[i + 1, i] = ab[1, i + 1]
            if i + 2 < T:
                A[i, i + 2] = ab[0, i + 2]
                A[i + 2, i] = ab[0, i + 2]
        return np.linalg.solve(A, b)

    def _apply_kinematic_forward_backward(
        self,
        p: np.ndarray,
        dt: float,
        v_max: float,
        a_max: float,
        c_min: float,
        c_max: float,
    ) -> np.ndarray:
        """Forward-backward pass clamping velocity and acceleration ramps."""
        N = len(p)
        if N <= 1:
            return np.clip(p, c_min, c_max)

        p_list = p.tolist()
        a_dt = a_max * dt
        inv_dt = 1.0 / dt

        # 1. Forward Pass
        x_fwd = [0.0] * N
        p0 = float(p_list[0])
        x_prev = c_min if p0 < c_min else (c_max if p0 > c_max else p0)
        v_prev = 0.0
        x_fwd[0] = x_prev

        for t in range(1, N):
            diff = (p_list[t] - x_prev) * inv_dt
            v_des = -v_max if diff < -v_max else (v_max if diff > v_max else diff)
            v_lo = v_prev - a_dt
            v_hi = v_prev + a_dt
            v_t = v_lo if v_des < v_lo else (v_hi if v_des > v_hi else v_des)
            nxt = x_prev + v_t * dt
            x_t = c_min if nxt < c_min else (c_max if nxt > c_max else nxt)
            v_prev = (x_t - x_prev) * inv_dt
            x_prev = x_t
            x_fwd[t] = x_t

        # 2. Backward Pass (Safe deceleration distance to stop without jerk)
        x_bwd = [0.0] * N
        x_next = x_fwd[-1]
        v_next = 0.0
        x_bwd[-1] = x_next

        for t in range(N - 2, -1, -1):
            xf = x_fwd[t]
            dist = x_next - xf
            abs_dist = -dist if dist < 0 else dist
            v_safe = math.sqrt(2.0 * a_max * abs_dist) if abs_dist > 0 else 0.0
            v_lim = v_safe if v_safe < v_max else v_max
            diff_dt = dist * inv_dt
            abs_diff_dt = -diff_dt if diff_dt < 0 else diff_dt
            clamped_mag = abs_diff_dt if abs_diff_dt < v_lim else v_lim
            v_des = clamped_mag if dist >= 0 else -clamped_mag
            v_lo = v_next - a_dt
            v_hi = v_next + a_dt
            v_t = v_lo if v_des < v_lo else (v_hi if v_des > v_hi else v_des)
            nxt = x_next - v_t * dt
            x_t = c_min if nxt < c_min else (c_max if nxt > c_max else nxt)
            v_next = (x_next - x_t) * inv_dt
            x_next = x_t
            x_bwd[t] = x_t

        # 3. Final strict kinematic projection forward pass
        x_final = [0.0] * N
        x_prev = x_fwd[0]
        v_prev = 0.0
        x_final[0] = x_prev

        for t in range(1, N):
            if t == N - 1:
                target = x_fwd[-1]
            else:
                xf = x_fwd[t]
                xb = x_bwd[t]
                if x_fwd[t + 1] >= x_fwd[t - 1]:
                    target = xf if xf < xb else xb
                else:
                    target = xf if xf > xb else xb

            diff = (target - x_prev) * inv_dt
            v_des = -v_max if diff < -v_max else (v_max if diff > v_max else diff)
            v_lo = v_prev - a_dt
            v_hi = v_prev + a_dt
            v_t = v_lo if v_des < v_lo else (v_hi if v_des > v_hi else v_des)
            nxt = x_prev + v_t * dt
            x_t = c_min if nxt < c_min else (c_max if nxt > c_max else nxt)
            v_prev = (x_t - x_prev) * inv_dt
            x_prev = x_t
            x_final[t] = x_t

        return np.array(x_final, dtype=np.float64)

    def _decompose_segments(
        self,
        crop_xs: np.ndarray,
        timestamps: np.ndarray,
        shots: List[Tuple[int, int]],
        dt: float,
    ) -> List[KinematicSegment]:
        """Decomposes discrete camera path into semantic 'hold', 'pan', and 'cut' actions."""
        segments: List[KinematicSegment] = []
        T = len(crop_xs)
        if T == 0:
            return segments

        xs = crop_xs.tolist()
        ts = timestamps.tolist()
        inv_dt = 1.0 / dt

        for s_idx, (s_start, s_end) in enumerate(shots):
            # If transition between shots exists, add a cut segment
            if s_idx > 0:
                prev_end = shots[s_idx - 1][1]
                segments.append(
                    KinematicSegment(
                        start_time=round(float(ts[prev_end]), 3),
                        end_time=round(float(ts[s_start]), 3),
                        start_crop_x=int(xs[prev_end]),
                        end_crop_x=int(xs[s_start]),
                        mode="cut",
                        max_velocity=0.0,
                    )
                )

            # Decompose within shot
            cur_start = s_start
            cur_mode = "hold"
            peak_v = 0.0

            for i in range(s_start + 1, s_end + 1):
                diff = xs[i] - xs[i - 1]
                dx = -diff if diff < 0 else diff
                step_v = dx * inv_dt
                is_moving = dx > 0

                step_mode = "pan" if is_moving else "hold"

                if step_mode != cur_mode:
                    # Flush current segment
                    segments.append(
                        KinematicSegment(
                            start_time=round(float(ts[cur_start]), 3),
                            end_time=round(float(ts[i - 1]), 3),
                            start_crop_x=int(xs[cur_start]),
                            end_crop_x=int(xs[i - 1]),
                            mode=cur_mode,
                            max_velocity=round(float(peak_v), 1),
                        )
                    )
                    cur_start = i - 1
                    cur_mode = step_mode
                    peak_v = step_v
                else:
                    if step_v > peak_v:
                        peak_v = step_v

            # Flush tail segment of this shot
            segments.append(
                KinematicSegment(
                    start_time=round(float(ts[cur_start]), 3),
                    end_time=round(float(ts[s_end]), 3),
                    start_crop_x=int(xs[cur_start]),
                    end_crop_x=int(xs[s_end]),
                    mode=cur_mode,
                    max_velocity=round(float(peak_v), 1),
                )
            )

        return segments

    def _build_ffmpeg_crop_expression(
        self,
        crop_w: int,
        crop_h: int,
        crop_xs: np.ndarray,
        timestamps: np.ndarray,
        shots: List[Tuple[int, int]],
        segments: List[KinematicSegment],
        canvas_w: int,
    ) -> Tuple[str, bool]:
        """Constructs an executable FFmpeg filter expression representing holds, cuts, and smooth pans."""
        if len(crop_xs) == 0:
            center_x = (canvas_w - crop_w) // 2
            return f"crop={crop_w}:{crop_h}:{center_x}:0", False

        median_x = int(np.median(crop_xs))
        if median_x % 2 != 0:
            median_x = max(0, median_x - 1)

        # 1. Total variation check: static hold if camera barely moves (< 16 px)
        if np.ptp(crop_xs) < 16:
            return f"crop={crop_w}:{crop_h}:{median_x}:0", False

        # 2. Multi-shot cut step function check (if cuts exist without continuous pans)
        has_pan = any(s.mode == "pan" and abs(s.end_crop_x - s.start_crop_x) >= 20 for s in segments)
        has_cuts = len(shots) > 1

        if has_cuts and not has_pan:
            # Step function across shots
            shot_specs = []
            for s_start, s_end in shots:
                t_end = round(float(timestamps[s_end]), 3)
                med_shot = int(np.median(crop_xs[s_start : s_end + 1]))
                if med_shot % 2 != 0:
                    med_shot = max(0, med_shot - 1)
                shot_specs.append((t_end, med_shot))

            expr = str(shot_specs[-1][1])
            for k in range(len(shot_specs) - 2, -1, -1):
                t_b, x_v = shot_specs[k]
                expr = f"if(lt(t,{t_b:.2f}),{x_v},{expr})"
            return f"crop={crop_w}:{crop_h}:'{expr}':0", True

        # 3. Continuous pan ramp expressions
        pan_segments = [s for s in segments if s.mode == "pan" and (s.end_time - s.start_time) > 0.1]
        if not pan_segments:
            return f"crop={crop_w}:{crop_h}:{median_x}:0", False

        # Build ramp piecewise expression
        active_segs = [s for s in segments if s.mode in ("hold", "pan")]
        if not active_segs:
            return f"crop={crop_w}:{crop_h}:{median_x}:0", False

        # Build reverse nested if expression
        expr = str(active_segs[-1].end_crop_x)
        for s in reversed(active_segs):
            if s.mode == "hold":
                expr = f"if(lt(t,{s.end_time:.2f}),{s.start_crop_x},{expr})"
            elif s.mode == "pan":
                x0 = s.start_crop_x
                x1 = s.end_crop_x
                t0 = s.start_time
                t1 = s.end_time
                dur = max(t1 - t0, 0.05)
                ramp = f"round({x0}+({x1}-{x0})*(t-{t0:.2f})/{dur:.2f})"
                expr = f"if(lt(t,{s.end_time:.2f}),{ramp},{expr})"

        return f"crop={crop_w}:{crop_h}:'{expr}':0", True


__all__ = [
    "TrajectoryConfig",
    "KinematicSegment",
    "TrajectoryResult",
    "ConstrainedTrajectoryOptimizer",
    "solveh_banded",
]
