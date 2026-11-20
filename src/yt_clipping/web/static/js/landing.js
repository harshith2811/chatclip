// Simulator State
    function setSimLayout(layout) {
      document.querySelectorAll('.stage-settings-side .setting-group:nth-child(2) .group-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      const crop = document.getElementById('simCropBox');
      const badge = document.getElementById('simRatioBadge');
      const label = document.getElementById('layoutNameLabel');

      if (layout === 'active_speaker') {
        crop.style.width = '200px';
        crop.style.height = '355px';
        crop.style.left = '36%';
        crop.style.top = '5%';
        badge.textContent = 'ACTIVE SPEAKER 9:16';
        label.textContent = 'Active Speaker';
      } else if (layout === 'blur_background') {
        crop.style.width = '280px';
        crop.style.height = '157px';
        crop.style.left = '25%';
        crop.style.top = '30%';
        badge.textContent = '16:9 IN GAUSSIAN BACKDROP';
        label.textContent = 'Blur Background';
      } else if (layout === 'split_screen') {
        crop.style.width = '200px';
        crop.style.height = '355px';
        crop.style.left = '36%';
        crop.style.top = '5%';
        badge.textContent = 'DUAL 9:8 PODCAST SPLIT';
        label.textContent = '9:8 Podcast';
      }
    }

    function setSimCaption(style) {
      document.querySelectorAll('.stage-settings-side .setting-group:nth-child(3) .group-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      const cap = document.getElementById('simCaptionText');
      const label = document.getElementById('captionNameLabel');
      cap.className = 'caption-pill cap-' + style;

      if (style === 'hormozi') {
        cap.textContent = '"NEVER LOSE FOCUS."';
        label.textContent = 'Hormozi Kinetic';
      } else if (style === 'beast') {
        cap.textContent = '💥 100,000 SUBSCRIBERS!';
        label.textContent = 'MrBeast Bounce';
      } else if (style === 'neon') {
        cap.textContent = 'CYBERPUNK TOKYO 2026';
        label.textContent = 'Neon Cyber';
      } else if (style === 'minimal') {
        cap.textContent = 'Silence is an answer.';
        label.textContent = 'Clean Editorial';
      }
    }

    function toggleSimAudio(enabled) {
      document.querySelectorAll('.stage-settings-side .setting-group:nth-child(4) .group-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      const label = document.getElementById('simDeadAirLabel');
      if (enabled) {
        label.textContent = 'PURGED (-320ms)';
        label.style.color = '#34d399';
      } else {
        label.textContent = 'RAW AUDIO';
        label.style.color = '#f59e0b';
      }
    }

    // Modal & Auth
    function openAuthModal(initialTab = 'tenant') {
      const modal = document.getElementById('authModal');
      modal.style.display = 'flex';
      switchAuthTab(initialTab);
    }

    function closeAuthModal() {
      document.getElementById('authModal').style.display = 'none';
      const box = document.getElementById('authStatusBox');
      if (box) box.style.display = 'none';
    }

    function handleModalBackdropClick(e) {
      if (e.target.id === 'authModal') closeAuthModal();
    }

    function switchAuthTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.getElementById('formTenant').style.display = tab === 'tenant' ? 'block' : 'none';
      document.getElementById('formPasskey').style.display = tab === 'passkey' ? 'block' : 'none';
      document.getElementById('sectionGoogle').style.display = tab === 'google' ? 'block' : 'none';

      if (tab === 'tenant') document.getElementById('tabTenant').classList.add('active');
      if (tab === 'passkey') document.getElementById('tabPasskey').classList.add('active');
      if (tab === 'google') document.getElementById('tabGoogle').classList.add('active');
    }

    function handleTenantSubmit(e) {
      e.preventDefault();
      const tid = document.getElementById('loginTid').value.trim();
      const box = document.getElementById('authStatusBox');

      box.style.display = 'block';
      box.style.background = '#ecfdf5';
      box.style.border = '1px solid #a7f3d0';
      box.style.color = '#065f46';
      box.innerHTML = `✅ Authenticated as <strong>${tid}</strong>. Launching workspace studio...`;
      setTimeout(() => {
        window.location.href = `/studio?tenant=${encodeURIComponent(tid)}`;
      }, 700);
    }

    function handlePasskeySubmit(e) {
      e.preventDefault();
      const role = document.getElementById('loginRole').value;
      const box = document.getElementById('authStatusBox');

      box.style.display = 'block';
      box.style.background = '#ecfdf5';
      box.style.border = '1px solid #a7f3d0';
      box.style.color = '#065f46';
      box.innerHTML = `✅ Passkey accepted for <strong>${role}</strong> role. Redirecting...`;
      setTimeout(() => {
        if (role === 'chambers') {
          window.location.href = 'http://localhost:3000';
        } else {
          window.location.href = '/studio';
        }
      }, 700);
    }

    function handleGoogleOAuth() {
      const box = document.getElementById('authStatusBox');
      box.style.display = 'block';
      box.style.background = '#eff6ff';
      box.style.border = '1px solid #bfdbfe';
      box.style.color = '#1e40af';
      box.innerHTML = 'Connecting to isolated Google OAuth channel...';
      setTimeout(() => {
        window.location.href = '/studio?auth=google_oauth_isolated';
      }, 800);
    }
  
    function toggleLandingDrawer() {
      const d = document.getElementById('landingMobileDrawer');
      if (d) d.classList.toggle('open');
    }
    function closeLandingDrawer() {
      const d = document.getElementById('landingMobileDrawer');
      if (d) d.classList.remove('open');
    }
