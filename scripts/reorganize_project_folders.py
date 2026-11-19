import os
import json
import re
import shutil

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
ASSETS_DIR = os.path.join(DATA_DIR, "assets")
RENDERED_CLIPS_DIR = os.path.join(DATA_DIR, "rendered_clips")

def sanitize_name(name: str, max_length: int = 40) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", name)
    cleaned = re.sub(r"[\s-]+", "_", cleaned).strip("_")
    return cleaned[:max_length] if cleaned else "video"

def reorganize():
    if not os.path.exists(PROJECTS_DIR):
        print("Projects dir does not exist.")
        return

    # 1. Clean up junk / empty test directories
    for d in list(os.listdir(PROJECTS_DIR)):
        full_d = os.path.join(PROJECTS_DIR, d)
        if not os.path.isdir(full_d):
            continue
        pj = os.path.join(full_d, "project.json")
        if not os.path.exists(pj):
            print(f"Purging empty/test junk directory: {d}")
            shutil.rmtree(full_d, ignore_errors=True)

    # 2. Reorganize valid project directories
    for d in list(os.listdir(PROJECTS_DIR)):
        full_d = os.path.join(PROJECTS_DIR, d)
        if not os.path.isdir(full_d):
            continue
        pj = os.path.join(full_d, "project.json")
        if not os.path.exists(pj):
            continue

        with open(pj, "r", encoding="utf-8") as f:
            data = json.load(f)

        video_id = data.get("video_id") or ""
        title = data.get("title") or f"Project_{video_id}"
        clean_title = sanitize_name(title)
        new_dir_name = f"{clean_title}_{video_id}"
        new_dir_path = os.path.join(PROJECTS_DIR, new_dir_name)

        if full_d != new_dir_path:
            print(f"Renaming {d} -> {new_dir_name}")
            if os.path.exists(new_dir_path):
                shutil.rmtree(new_dir_path, ignore_errors=True)
            os.rename(full_d, new_dir_path)
            full_d = new_dir_path
            pj = os.path.join(full_d, "project.json")

        # 3. Link or reference source video inside project folder
        source_target = os.path.join(ASSETS_DIR, f"{video_id}.mp4")
        project_source = os.path.join(full_d, "source.mp4")
        if os.path.exists(source_target) and not os.path.exists(project_source):
            try:
                # Try hardlink, fallback to copy
                try:
                    os.link(source_target, project_source)
                except Exception:
                    shutil.copyfile(source_target, project_source)
                print(f"Linked source video for {video_id} in {new_dir_name}/source.mp4")
            except Exception as e:
                print(f"Could not link source video: {e}")

        # 4. Organize clips folder with descriptive naming
        clips_dir = os.path.join(full_d, "clips")
        os.makedirs(clips_dir, exist_ok=True)

        # Inspect sidecars in clips_dir
        sidecar_files = [f for f in os.listdir(clips_dir) if f.endswith(".json")]
        clip_index = 1
        for sf in sidecar_files:
            sf_path = os.path.join(clips_dir, sf)
            try:
                with open(sf_path, "r", encoding="utf-8") as f:
                    sc = json.load(f)
            except Exception:
                continue

            hook_title = (
                sc.get("caption_package", {}).get("hook_title")
                or sc.get("candidate_data", {}).get("hook_title")
                or f"Clip_{clip_index}"
            )
            clean_hook = sanitize_name(hook_title, max_length=45)
            start_s = round(sc.get("start_seconds", 0.0))
            end_s = round(sc.get("end_seconds", 0.0))
            clean_base = f"{clip_index:02d}_{clean_hook}_{start_s}s_{end_s}s"

            # Check original media file
            original_media = sc.get("file_path", "")
            if not original_media or not os.path.exists(original_media):
                # Search in rendered_clips
                for rf in os.listdir(RENDERED_CLIPS_DIR):
                    if video_id in rf and f"{start_s}" in rf and rf.endswith(".mp4"):
                        original_media = os.path.join(RENDERED_CLIPS_DIR, rf)
                        break

            target_mp4 = os.path.join(clips_dir, f"{clean_base}.mp4")
            target_json = os.path.join(clips_dir, f"{clean_base}.json")

            if original_media and os.path.exists(original_media):
                if not os.path.exists(target_mp4):
                    try:
                        shutil.copyfile(original_media, target_mp4)
                        print(f"Copied {os.path.basename(original_media)} -> clips/{clean_base}.mp4")
                    except Exception as e:
                        print(f"Copy error: {e}")

                # Update sidecar paths
                sc["file_path"] = target_mp4
                sc["relative_url"] = f"/clips/{os.path.basename(original_media)}" # keep web compatibility
                with open(target_json, "w", encoding="utf-8") as f:
                    json.dump(sc, f, indent=2)

                # If original sf was named clip_job-..., we can remove or keep
                if sf != f"{clean_base}.json" and os.path.exists(target_json):
                    try:
                        os.remove(sf_path)
                    except Exception:
                        pass
                clip_index += 1

    print("Reorganization complete!")

if __name__ == "__main__":
    reorganize()
