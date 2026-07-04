import React, { useEffect } from 'react';
import './SplashScreen.css';
import doctorLogo from '../../../newlogo.jpeg';

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
        <img src={doctorLogo} alt="Abhaya Medical Care logo" width="80" height="80" style={{ objectFit: 'contain', borderRadius: '12px' }} />
        <span className="logo-text">Abhaya</span>
      </div>
      <p className="tagline">Medical Care</p>
    </div>
  );
};

export default SplashScreen;
