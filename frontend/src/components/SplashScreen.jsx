import React, { useEffect } from 'react';
import './SplashScreen.css';

const SplashScreen = () => {
  // The splash screen is displayed while the app shows its branding.
  // All navigation timing is handled by the parent App component via the
  // `showSplash` state, so this component only renders the visual elements.
  useEffect(() => {
    // Placeholder for any analytics or side‑effects that should run once.
  }, []);

  return (
    <div className="splash-screen">
      <div className="logo-container">
        {/* Re‑use the SVG logo from the login screen for consistency */}
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#d9383a" strokeWidth="2.5">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          <path d="M12 5v14M5 12h14" stroke="#ffffff" strokeWidth="1.5" />
        </svg>
        <span className="logo-text">Abhaya</span>
      </div>
      <p className="tagline">Medical Care</p>
    </div>
  );
};

export default SplashScreen;
