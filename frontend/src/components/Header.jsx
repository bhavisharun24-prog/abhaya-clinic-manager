import React, { useContext } from 'react';
import { AppContext } from '../App';
import doctorLogo from '../../../newlogo.jpeg';

export default function Header({ handleLogout }) {
  const { user, wsStatus } = useContext(AppContext);

  return (
    <header className="hospital-header">
      <div className="header-branding">
        <img src={doctorLogo} alt="Abhaya Medical Care logo" className="clinic-logo" style={{ height: '52px', width: '52px', objectFit: 'contain' }} />
        <div className="clinic-title-area">
          <h1 className="clinic-name" style={{ color: 'white' }}>ABHAYA MEDICAL CARE</h1>
          <span className="clinic-tagline">Compassion... Care... Cure...</span>
        </div>
      </div>

      <div className="header-meta">
        <div className="dr-details" style={{ color: 'white' }}>
          <div className="dr-name">Dr. Raveesha .A</div>
          <div className="dr-spec">M.B.B.S, M.D, F.A.G.E, M.N.A.M.S.</div>
        </div>

        <div className="user-status">
          <span className="role-badge">{user?.role}</span>
          
          {/* WebSocket Live Sync Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#94a3b8' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: wsStatus === 'connected' ? '#12b76a' : wsStatus === 'connecting' ? '#f37021' : '#f04438',
              boxShadow: wsStatus === 'connected' ? '0 0 8px #12b76a' : '0 0 8px #f37021',
              display: 'inline-block'
            }} />
            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>
              {wsStatus === 'connected' ? 'LAN Sync Online' : wsStatus === 'connecting' ? 'Connecting...' : 'Sync Offline'}
            </span>
          </div>

          <button onClick={handleLogout} className="btn-logout">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
