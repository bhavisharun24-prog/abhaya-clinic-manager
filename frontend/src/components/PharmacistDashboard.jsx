import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

export default function PharmacistDashboard() {
  const { activeTab, setActiveTab, wsMessage, clearWsMessage, user } = useContext(AppContext);
  const host = window.location.hostname || 'localhost';

  // State definitions
  const [pendingQueue, setPendingQueue] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  
  // Billing States
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [customCharges, setCustomCharges] = useState(0);

  // Inventory States
  const [inventory, setInventory] = useState([]);
  const [showInvModal, setShowInvModal] = useState(false);
  const [invForm, setInvForm] = useState({ id: null, name: '', stock_quantity: '', unit_price: '' });

  // Calendar States
  const [calendarDays, setCalendarDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [dayAppointments, setDayAppointments] = useState([]);
  const [showApptModal, setShowApptModal] = useState(false);
  const [newAppt, setNewAppt] = useState({ patient_id: '', patient_name: '', patient_contact: '', time_slot: '09:00 AM' });

  // Reports State
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [eodReport, setEodReport] = useState({ transactions: [], cashTotal: 0, upiTotal: 0, grandTotal: 0 });

  // Fetch initial data
  useEffect(() => {
    fetchPendingQueue();
    fetchInventory();
    fetchCalendarStats();
    fetchAppointments(selectedDate);
    fetchEodReport(reportDate);
  }, []);

  // Listen to WebSockets pushes
  useEffect(() => {
    if (wsMessage) {
      console.log('WS Message received in Pharmacist View:', wsMessage);
      if (wsMessage.type === 'NEW_PRESCRIPTION') {
        // Append new prescription to queue
        setPendingQueue(prev => {
          if (prev.some(rx => rx.id === wsMessage.data.id)) return prev;
          return [...prev, wsMessage.data];
        });
        // Play notification sound if available, otherwise browser alert
        alert(`🔔 New Prescription Received for ${wsMessage.data.patient_name}!`);
      } else if (wsMessage.type === 'PRESCRIPTION_UPDATED') {
        const update = wsMessage.data;
        // Update local list statuses (verified or billed)
        setPendingQueue(prev => {
          if (update.status === 'billed') {
            // Remove from queue on billing completion
            return prev.filter(rx => rx.id !== update.id);
          }
          return prev.map(rx => rx.id === update.id ? { ...rx, status: update.status } : rx);
        });

        if (selectedRx && selectedRx.id === update.id) {
          setSelectedRx(prev => ({ ...prev, status: update.status }));
        }
        
        fetchInventory(); // Refetch stocks
        fetchEodReport(reportDate); // Refetch report
      }
      clearWsMessage(); // Consume message
    }
  }, [wsMessage]);

  // Fetch queue
  const fetchPendingQueue = async () => {
    try {
      const res = await fetch(`http://${host}:5000/api/prescriptions/pending`);
      const data = await res.json();
      setPendingQueue(data.filter(rx => rx.status !== 'billed'));
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch inventory
  const fetchInventory = async () => {
    try {
      const res = await fetch(`http://${host}:5000/api/inventory`);
      const data = await res.json();
      setInventory(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch calendar summary of days to display booking load counts
  const fetchCalendarStats = async () => {
    // Generate next 14 days dates
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      
      // Fetch appointment count for that day
      try {
        const res = await fetch(`http://${host}:5000/api/appointments?date=${dateStr}`);
        const appts = await res.json();
        days.push({
          dateStr,
          dayNum: d.getDate(),
          monthStr: d.toLocaleString('default', { month: 'short' }),
          weekdayStr: d.toLocaleString('default', { weekday: 'short' }),
          count: appts.filter(a => a.status !== 'cancelled').length
        });
      } catch (err) {
        console.error(err);
      }
    }
    setCalendarDays(days);
  };

  // Fetch day appointments
  const fetchAppointments = async (date) => {
    try {
      const res = await fetch(`http://${host}:5000/api/appointments?date=${date}`);
      const data = await res.json();
      setDayAppointments(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch EOD report
  const fetchEodReport = async (date) => {
    try {
      const res = await fetch(`http://${host}:5000/api/reports/eod?date=${date}`);
      const data = await res.json();
      setEodReport(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Verify prescription (Pharmacist locks/confirms)
  const handleVerifyPrescription = async (rxId) => {
    try {
      const res = await fetch(`http://${host}:5000/api/prescriptions/${rxId}/verify`, {
        method: 'PUT'
      });
      if (!res.ok) throw new Error('Verification failed');
      alert('Prescription Verified!');
      fetchPendingQueue();
      // Reload selected item
      if (selectedRx) setSelectedRx(prev => ({ ...prev, status: 'verified' }));
    } catch (err) {
      alert(err.message);
    }
  };

  // Finalize billing and post bill
  const handleGenerateBill = async () => {
    if (!selectedRx) return;
    const medicinesTotal = calculateMedsCost(selectedRx.medicines);
    const totalAmount = medicinesTotal + selectedRx.consultation_fee + parseFloat(customCharges || 0);

    try {
      const res = await fetch(`http://${host}:5000/api/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prescription_id: selectedRx.id,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          verified_by: user.username
        })
      });
      if (!res.ok) throw new Error('Billing transaction failed');
      
      alert('Billing invoice registered and saved successfully!');
      setSelectedRx(null);
      setCustomCharges(0);
      fetchPendingQueue();
      fetchInventory();
      fetchEodReport(reportDate);
    } catch (err) {
      alert(err.message);
    }
  };

  // Helper cost calculator
  const calculateMedsCost = (meds) => {
    if (!meds) return 0;
    return meds.reduce((acc, med) => {
      // Find unit price from inventory
      const invItem = inventory.find(i => i.name.toLowerCase() === med.name.toLowerCase());
      const price = invItem ? invItem.unit_price : 0;
      const qty = parseInt(med.quantity || med.duration || 1);
      return acc + (price * qty);
    }, 0);
  };

  // Add/Edit inventory
  const handleSaveInventory = async (e) => {
    e.preventDefault();
    const payload = {
      name: invForm.name,
      stock_quantity: invForm.stock_quantity,
      unit_price: invForm.unit_price
    };

    try {
      let res;
      if (invForm.id) {
        // Edit mode
        res = await fetch(`http://${host}:5000/api/inventory/${invForm.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Add mode
        res = await fetch(`http://${host}:5000/api/inventory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      if (!res.ok) throw new Error('Failed to save item. Make sure name is unique.');
      
      setShowInvModal(false);
      setInvForm({ id: null, name: '', stock_quantity: '', unit_price: '' });
      fetchInventory();
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete inventory item
  const handleDeleteInventory = async (id) => {
    if (!confirm('Are you sure you want to delete this medicine?')) return;
    try {
      const res = await fetch(`http://${host}:5000/api/inventory/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchInventory();
    } catch (err) {
      alert(err.message);
    }
  };

  // Open Edit inventory modal
  const openEditInv = (item) => {
    setInvForm(item);
    setShowInvModal(true);
  };

  // Appointment actions
  const handleSelectCalendarDate = (date) => {
    setSelectedDate(date);
    fetchAppointments(date);
  };

  const handleCreateAppointment = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`http://${host}:5000/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newAppt,
          date: selectedDate
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to book slot');

      setShowApptModal(false);
      setNewAppt({ patient_id: '', patient_name: '', patient_contact: '', time_slot: '09:00 AM' });
      fetchAppointments(selectedDate);
      fetchCalendarStats();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUpdateApptStatus = async (apptId, newStatus) => {
    try {
      const res = await fetch(`http://${host}:5000/api/appointments/${apptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Failed to update status');
      fetchAppointments(selectedDate);
      fetchCalendarStats();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="sidebar-menu">
          <div 
            onClick={() => setActiveTab('calendar')} 
            className={`sidebar-tab ${activeTab === 'calendar' ? 'active' : ''}`}
          >
            <span>Appointment Calendar</span>
          </div>
          <div 
            onClick={() => setActiveTab('inventory')} 
            className={`sidebar-tab ${activeTab === 'inventory' ? 'active' : ''}`}
          >
            <span>Medicine Inventory</span>
          </div>
          <div 
            onClick={() => setActiveTab('billing_queue')} 
            className={`sidebar-tab ${activeTab === 'billing_queue' ? 'active' : ''}`}
          >
            <span>Verification & Billing</span>
            {pendingQueue.length > 0 && (
              <span style={{
                marginLeft: 'auto',
                backgroundColor: '#d9383a',
                color: 'white',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                padding: '1px 6px',
                borderRadius: '99px'
              }}>{pendingQueue.length}</span>
            )}
          </div>
          <div 
            onClick={() => setActiveTab('reports')} 
            className={`sidebar-tab ${activeTab === 'reports' ? 'active' : ''}`}
          >
            <span>Daily Ledger Reports</span>
          </div>
        </div>
        <div className="sidebar-footer">
          <div>System 2 — Pharmacist PC</div>
          <div style={{ opacity: 0.6 }}>Connected Client Mode</div>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
        {activeTab === 'calendar' && (
          <div>
            <div className="card">
              <h2 style={{ marginBottom: '1rem' }}>Appointment Manager</h2>
              <p style={{ color: '#667085', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Select a day to view bookings or schedule a patient. Enforces a strict limit of <strong>45 slots</strong> per day.
              </p>

              {/* Rolling 14-days grid */}
              <div className="calendar-grid">
                {calendarDays.map(day => {
                  const isFull = day.count >= 45;
                  const isSelected = day.dateStr === selectedDate;
                  return (
                    <div 
                      key={day.dateStr} 
                      onClick={() => handleSelectCalendarDate(day.dateStr)}
                      className={`calendar-day ${isFull ? 'full' : ''}`}
                      style={{
                        borderColor: isSelected ? '#d9383a' : isFull ? '#fcdcd9' : '#eaecf0',
                        borderWidth: isSelected ? '2px' : '1px',
                        backgroundColor: isSelected ? '#fff8f8' : isFull ? '#fff3f2' : 'white',
                        transform: isSelected ? 'scale(1.02)' : 'none',
                        boxShadow: isSelected ? 'var(--shadow-sm)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                          {day.weekdayStr}
                        </span>
                        <span className="day-number" style={{ color: isFull ? '#b32318' : '#101b42' }}>
                          {day.dayNum} {day.monthStr}
                        </span>
                      </div>
                      <div className={`day-badge ${isFull ? 'full' : ''}`} style={{ alignSelf: 'flex-end', marginTop: '1rem' }}>
                        {isFull ? 'FULL' : `${day.count}/45 Slots`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Appointments list for selected day */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>Bookings for: {selectedDate}</h3>
                <button 
                  className="btn btn-primary" 
                  disabled={dayAppointments.filter(a => a.status !== 'cancelled').length >= 45}
                  onClick={() => setShowApptModal(true)}
                >
                  + Book Appointment
                </button>
              </div>

              {dayAppointments.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#667085', padding: '2rem' }}>
                  No appointments scheduled for this date.
                </div>
              ) : (
                <table className="medicine-table">
                  <thead>
                    <tr>
                      <th>Time Slot</th>
                      <th>Patient Name</th>
                      <th>Contact Info</th>
                      <th>Status</th>
                      <th style={{ width: '140px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayAppointments.map(appt => (
                      <tr key={appt.id}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{appt.time_slot}</td>
                        <td>{appt.patient_name || `Patient ID: ${appt.patient_id}`}</td>
                        <td>{appt.patient_contact}</td>
                        <td>
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: appt.status === 'booked' ? '#eff8ff' : appt.status === 'completed' ? '#ecfdf3' : '#fef3f2',
                            color: appt.status === 'booked' ? '#175cd3' : appt.status === 'completed' ? '#027a48' : '#b32318'
                          }}>{appt.status}</span>
                        </td>
                        <td>
                          {appt.status === 'booked' && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button onClick={() => handleUpdateApptStatus(appt.id, 'completed')} className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: '0.75rem' }}>
                                ✔️ Done
                              </button>
                              <button onClick={() => handleUpdateApptStatus(appt.id, 'cancelled')} className="btn btn-danger" style={{ padding: '2px 6px', fontSize: '0.75rem' }}>
                                ❌ Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2>Medicine Stocks Inventory</h2>
                <p style={{ color: '#667085', fontSize: '0.9rem', marginTop: '4px' }}>
                  Register or edit medicines in stock. Stock changes auto-deduct during prescription billing checkout.
                </p>
              </div>
              <button className="btn btn-primary" onClick={() => {
                setInvForm({ id: null, name: '', stock_quantity: '', unit_price: '' });
                setShowInvModal(true);
              }}>
                + Register Medicine
              </button>
            </div>

            <table className="medicine-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>ID</th>
                  <th>Medicine Name</th>
                  <th>Stock Quantity</th>
                  <th>Unit Price (INR)</th>
                  <th style={{ width: '120px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'monospace' }}>#{item.id}</td>
                    <td style={{ fontWeight: 600, color: '#101b42' }}>{item.name}</td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        color: item.stock_quantity < 50 ? '#b32318' : 'inherit',
                        backgroundColor: item.stock_quantity < 50 ? '#fef3f2' : 'transparent',
                        padding: item.stock_quantity < 50 ? '2px 6px' : '0',
                        borderRadius: '4px'
                      }}>
                        {item.stock_quantity} units {item.stock_quantity < 50 && '⚠️ Low'}
                      </span>
                    </td>
                    <td>₹{item.unit_price.toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button onClick={() => openEditInv(item)} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                          ✏️ Edit
                        </button>
                        <button onClick={() => handleDeleteInventory(item.id)} className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'billing_queue' && (
          <div className="prescription-workspace">
            {/* Left Column: List of Prescriptions */}
            <div className="card" style={{ marginBottom: 0 }}>
              <h3>Prescriptions Verification Queue</h3>
              <p style={{ color: '#667085', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Real-time queue showing sent prescriptions from Doctor PC.
              </p>

              {pendingQueue.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#667085', padding: '2rem' }}>
                  No pending prescriptions in the queue.
                </div>
              ) : (
                <div className="rx-queue">
                  {pendingQueue.map(rx => (
                    <div 
                      key={rx.id} 
                      onClick={() => {
                        setSelectedRx(rx);
                        setCustomCharges(0);
                      }}
                      className={`card rx-queue-card ${rx.status === 'verified' ? 'verified' : ''}`}
                      style={{
                        padding: '1rem',
                        cursor: 'pointer',
                        borderColor: selectedRx?.id === rx.id ? '#d9383a' : '#eaecf0',
                        backgroundColor: selectedRx?.id === rx.id ? '#fff8f8' : 'white',
                        marginBottom: 0
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, color: '#101b42' }}>{rx.patient_name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {new Date(rx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                        <span style={{ color: '#667085' }}>ID: {rx.patient_id} • {rx.medicines.length} Medicines</span>
                        <span style={{
                          fontWeight: 600,
                          color: rx.status === 'verified' ? '#027a48' : '#f37021',
                          textTransform: 'uppercase',
                          fontSize: '0.7rem'
                        }}>{rx.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Verification & Checkout Invoice */}
            <div style={{ width: '100%' }}>
              {selectedRx ? (
                <div className="card" style={{ marginBottom: 0 }}>
                  <h3 style={{ borderBottom: '1px solid #eaecf0', paddingBottom: '8px', marginBottom: '12px' }}>
                    Checkout Invoice
                  </h3>
                  
                  {/* Patient Details banner */}
                  <div style={{ fontSize: '0.85rem', marginBottom: '12px' }}>
                    <div><strong>Patient:</strong> {selectedRx.patient_name} ({selectedRx.patient_id})</div>
                    <div><strong>Consultation Fee:</strong> ₹{selectedRx.consultation_fee}</div>
                    {selectedRx.attached_image_path && (
                      <div style={{ marginTop: '8px' }}>
                        <a 
                          href={`http://${host}:5000${selectedRx.attached_image_path}`} 
                          target="_blank" 
                          rel="noreferrer"
                          style={{ color: '#d9383a', textDecoration: 'underline', fontSize: '0.8rem', fontWeight: 600 }}
                        >
                          🖼️ View Attached Scan
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Medicines table checkout */}
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '6px' }}>Prescribed Medicines</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #eaecf0', textAlign: 'left', color: '#667085' }}>
                        <th style={{ padding: '4px 0' }}>Item</th>
                        <th>Qty</th>
                        <th style={{ textAlign: 'right' }}>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRx.medicines.map((m, idx) => {
                        const invItem = inventory.find(i => i.name.toLowerCase() === m.name.toLowerCase());
                        const price = invItem ? invItem.unit_price : 0;
                        const qty = parseInt(m.quantity || m.duration || 1);
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #f2f4f7' }}>
                            <td style={{ padding: '6px 0', fontWeight: 600 }}>{m.name}</td>
                            <td>{qty}</td>
                            <td style={{ textAlign: 'right' }}>₹{(price * qty).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Pricing Breakdown counter */}
                  <div style={{ borderTop: '2px solid #101b42', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Medicines Total:</span>
                      <span>₹{calculateMedsCost(selectedRx.medicines).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Consultation Fee:</span>
                      <span>₹{selectedRx.consultation_fee.toFixed(2)}</span>
                    </div>
                    
                    {/* Add extra charges if needed */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Other Charges:</span>
                      <input 
                        type="number" 
                        placeholder="₹0"
                        className="form-input"
                        value={customCharges}
                        onChange={e => setCustomCharges(e.target.value)}
                        style={{ width: '80px', padding: '2px 6px', fontSize: '0.8rem', textAlign: 'right' }}
                      />
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.2rem', color: '#101b42', borderTop: '1px dashed #d0d5dd', paddingTop: '8px', marginTop: '4px' }}>
                      <span>Grand Total:</span>
                      <span>₹{(calculateMedsCost(selectedRx.medicines) + selectedRx.consultation_fee + parseFloat(customCharges || 0)).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment selector and verification trigger */}
                  <div style={{ marginTop: '1.5rem' }}>
                    {selectedRx.status === 'sent' ? (
                      <button onClick={() => handleVerifyPrescription(selectedRx.id)} className="btn btn-primary" style={{ width: '100%' }}>
                        🔍 Verify Prescription (Check Stock)
                      </button>
                    ) : (
                      <div>
                        <div className="form-group">
                          <label>Payment Method</label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              type="button" 
                              onClick={() => setPaymentMethod('cash')}
                              style={{
                                flex: 1, padding: '0.5rem', border: '1px solid #d0d5dd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                                backgroundColor: paymentMethod === 'cash' ? '#101b42' : 'white',
                                color: paymentMethod === 'cash' ? 'white' : '#344054'
                              }}
                            >💵 Cash</button>
                            <button 
                              type="button" 
                              onClick={() => setPaymentMethod('upi')}
                              style={{
                                flex: 1, padding: '0.5rem', border: '1px solid #d0d5dd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                                backgroundColor: paymentMethod === 'upi' ? '#101b42' : 'white',
                                color: paymentMethod === 'upi' ? 'white' : '#344054'
                              }}
                            >📱 UPI / QR</button>
                          </div>
                        </div>

                        <button onClick={handleGenerateBill} className="btn btn-primary" style={{ width: '100%', padding: '0.8rem' }}>
                          🖨️ Complete Checkout & Bill
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '280px', color: '#94a3b8', border: '2px dashed #d0d5dd', marginBottom: 0 }}>
                  Select a patient prescription from the queue to process billing.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div>
            <div className="card">
              <h2>Daily Financial Summary</h2>
              <p style={{ color: '#667085', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                Review cash and UPI revenue logs. Press the browser print dialog to print or save a daily statement.
              </p>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontWeight: 600 }}>Select Date:</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    value={reportDate}
                    onChange={e => {
                      setReportDate(e.target.value);
                      fetchEodReport(e.target.value);
                    }}
                    style={{ width: '180px' }}
                  />
                </div>
                <button onClick={() => window.print()} className="btn btn-secondary">
                  🖨️ Print Ledger Report
                </button>
              </div>

              {/* Financial stats banner */}
              <div className="stats-row">
                <div className="stat-card">
                  <span className="stat-title">Cash Revenue</span>
                  <span className="stat-value cash">₹{eodReport.cashTotal.toFixed(2)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-title">UPI Revenue</span>
                  <span className="stat-value upi">₹{eodReport.upiTotal.toFixed(2)}</span>
                </div>
                <div className="stat-card" style={{ borderBottom: '4px solid #12b76a' }}>
                  <span className="stat-title">Grand Total Ledger</span>
                  <span className="stat-value">₹{eodReport.grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Ledger transactions list */}
              <h3>Transaction Breakdown</h3>
              {eodReport.transactions.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#667085', padding: '2rem' }}>
                  No transactions billed on this date.
                </div>
              ) : (
                <table className="medicine-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Patient</th>
                      <th>Verified By</th>
                      <th>Method</th>
                      <th style={{ textAlign: 'right' }}>Total Bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eodReport.transactions.map(tx => (
                      <tr key={tx.id}>
                        <td>{new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ fontWeight: 600 }}>{tx.patient_name} <span style={{ color: '#667085', fontSize: '0.8rem', fontWeight: 400 }}>({tx.patient_id})</span></td>
                        <td>{tx.verified_by}</td>
                        <td style={{ textTransform: 'uppercase', fontWeight: 600 }}>{tx.payment_method}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#101b42' }}>₹{tx.total_amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Print format invoice wrapper hidden on screen */}
            <div className="print-invoice" style={{ display: 'none' }}>
              <div style={{ textAlign: 'center', marginBottom: '2rem', borderBottom: '2px solid black', paddingBottom: '1rem' }}>
                <h2>ABHAYA MEDICAL CARE</h2>
                <p>Compassion... Care... Cure...</p>
                <p>Daily Financial Summary - Date: {reportDate}</p>
              </div>
              <div>
                <p><strong>Grand Total:</strong> ₹{eodReport.grandTotal.toFixed(2)}</p>
                <p><strong>Cash Revenue:</strong> ₹{eodReport.cashTotal.toFixed(2)}</p>
                <p><strong>UPI Revenue:</strong> ₹{eodReport.upiTotal.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Inventory modal */}
      {showInvModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{invForm.id ? 'Edit Medicine Details' : 'Register New Medicine'}</h3>
            <form onSubmit={handleSaveInventory}>
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Medicine Name</label>
                <input 
                  type="text" 
                  required 
                  className="form-input"
                  value={invForm.name}
                  onChange={e => setInvForm({ ...invForm, name: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Stock Count</label>
                  <input 
                    type="number" 
                    required 
                    min="0"
                    className="form-input"
                    value={invForm.stock_quantity}
                    onChange={e => setInvForm({ ...invForm, stock_quantity: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Unit Price (INR)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    min="0.01"
                    className="form-input"
                    value={invForm.unit_price}
                    onChange={e => setInvForm({ ...invForm, unit_price: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '2rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowInvModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Inventory
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appointments slot scheduling modal */}
      {showApptModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Schedule Slot: {selectedDate}</h3>
            <form onSubmit={handleCreateAppointment}>
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Patient ID (Optional if new)</label>
                <input 
                  type="text" 
                  className="form-input"
                  placeholder="e.g. A001"
                  value={newAppt.patient_id}
                  onChange={e => setNewAppt({ ...newAppt, patient_id: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Patient Name</label>
                <input 
                  type="text" 
                  required 
                  className="form-input"
                  value={newAppt.patient_name}
                  onChange={e => setNewAppt({ ...newAppt, patient_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Contact Phone Number</label>
                <input 
                  type="tel" 
                  required 
                  className="form-input"
                  value={newAppt.patient_contact}
                  onChange={e => setNewAppt({ ...newAppt, patient_contact: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Time Slot</label>
                <select 
                  className="form-input"
                  value={newAppt.time_slot}
                  onChange={e => setNewAppt({ ...newAppt, time_slot: e.target.value })}
                >
                  <option value="09:00 AM">09:00 AM</option>
                  <option value="09:30 AM">09:30 AM</option>
                  <option value="10:00 AM">10:00 AM</option>
                  <option value="10:30 AM">10:30 AM</option>
                  <option value="11:00 AM">11:00 AM</option>
                  <option value="11:30 AM">11:30 AM</option>
                  <option value="12:00 PM">12:00 PM</option>
                  <option value="12:30 PM">12:30 PM</option>
                  <option value="04:00 PM">04:00 PM</option>
                  <option value="04:30 PM">04:30 PM</option>
                  <option value="05:00 PM">05:00 PM</option>
                  <option value="05:30 PM">05:30 PM</option>
                  <option value="06:00 PM">06:00 PM</option>
                  <option value="06:30 PM">06:30 PM</option>
                  <option value="07:00 PM">07:00 PM</option>
                  <option value="07:30 PM">07:30 PM</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '2rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowApptModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Book Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
