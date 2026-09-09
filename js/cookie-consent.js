/**
 * ImgDrop - Cookie Consent Manager
 * Compliant with Google AdSense, GDPR & ePrivacy regulations
 */
(function () {
  const CONSENT_KEY = 'imgdrop_cookie_consent';

  function initCookieConsent() {
    const existingConsent = localStorage.getItem(CONSENT_KEY);
    if (existingConsent) {
      return;
    }

    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie Consent');
    banner.innerHTML = `
      <div class="cookie-content">
        <span class="cookie-icon" aria-hidden="true">🍪</span>
        <div class="cookie-text">
          We use cookies and local storage to optimize site functionality and display relevant advertisements via Google AdSense. 
          Your images are processed 100% locally in your browser and never leave your device. 
          Learn more in our <a href="privacy.html">Privacy Policy</a> and <a href="cookies.html">Cookie Policy</a>.
        </div>
      </div>
      <div class="cookie-actions">
        <button type="button" class="cookie-btn cookie-btn-secondary" id="btn-cookie-essential">Essential Only</button>
        <button type="button" class="cookie-btn cookie-btn-primary" id="btn-cookie-accept">Accept All</button>
      </div>
    `;

    document.body.appendChild(banner);

    const acceptBtn = document.getElementById('btn-cookie-accept');
    const essentialBtn = document.getElementById('btn-cookie-essential');

    function closeBanner(status) {
      localStorage.setItem(CONSENT_KEY, status);
      banner.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(20px)';
      setTimeout(() => {
        if (banner.parentNode) {
          banner.parentNode.removeChild(banner);
        }
      }, 300);
    }

    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => closeBanner('all'));
    }
    if (essentialBtn) {
      essentialBtn.addEventListener('click', () => closeBanner('essential'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookieConsent);
  } else {
    initCookieConsent();
  }
})();
