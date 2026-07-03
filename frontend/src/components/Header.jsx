import React, { useContext } from 'react';
import { AppContext } from '../App';

export default function Header({ handleLogout }) {
  const { user, wsStatus } = useContext(AppContext);

  return (
    <header className="hospital-header">
      <div className="header-branding">
        {/* Vector SVG Logo: Heart + Pulse Line + Hand Motif */}
        <svg viewBox="0 0 100 100" className="clinic-logo" style={{ height: '52px', width: '52px' }}>
          {/* Hand Motif at Bottom */}
          <path d="M20,75 C35,85 65,85 80,75 C70,68 62,70 50,70 C38,70 30,68 20,75 Z" fill="#ffffff" opacity="0.9" />
          <path d="M25,73 C38,62 62,62 75,73 C75,73 68,66 50,66 C32,66 25,73 25,73 Z" fill="#ffffff" />
          {/* Heart Motif in Red */}
          <path d="M50,22 C40,5 15,12 15,38 C15,62 50,76 50,76 C50,76 85,62 85,38 C85,12 60,5 50,22 Z" fill="none" stroke="#d9383a" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Pulse Line inside Heart */}
          <path d="M22,38 L38,38 L43,26 L48,50 L53,32 L58,42 L63,38 L78,38" fill="none" stroke="#f37021" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="clinic-title-area">
          <h1 className="clinic-name" style={{ color: 'white' }}>ABHAYA MEDICAL CARE</h1>
          <span className="clinic-tagline">Compassion... Care... Cure...</span>
        </div>
      </div>

      <div className="header-meta">
        <div className="dr-details" style={{ color: 'white' }}>
          <div className="dr-name">Dr. Raveesha .A</div>
          <div className="dr-spec">M.B.B.S, M.S, F.I.A.C.S.</div>
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
