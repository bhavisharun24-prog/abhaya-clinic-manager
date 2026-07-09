import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '../App';

const defaultInventoryForm = {
  id: null,
  name: '',
  stock_quantity: '',
  unit_price: '',
  molecule: '',
  batch_number: '',
  manufacturer: '',
  dosage: '',
  expiry_date: ''
};

const defaultOutPatient = {
  name: '',
  mobile: '',
  medicine: '',
  quantity: '1'
};

const consultationStep = 50;
const minimumConsultationFee = 400;
const frequencyKeys = ['m', 'a', 'e', 'n', 'sos'];

const normalizePayload = (rx) => {
  const payload = rx?.payload || rx || {};
  return {
    medicines: Array.isArray(payload.medicines) ? payload.medicines : [],
    chiefComplaints: Array.isArray(payload.chief_complaints) ? payload.chief_complaints : [],
    vitals: payload.vitals || {},
    clinicalFindings: payload.clinical_findings || {},
    diagnosis: payload.diagnosis || '',
    consultationFee: Number(payload.consultation_fee || rx?.consultation_fee || minimumConsultationFee),
    prescriptionDate: payload.prescription_date || rx?.prescription_date || ''
  };
};

const getDaysToExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const diff = new Date(expiryDate).getTime() - new Date().getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

export default function PharmacistDashboardV2() {
  const { activeTab, setActiveTab, wsMessage, clearWsMessage, user } = useContext(AppContext);
  const host = window.location.hostname || '127.0.0.1';
  const apiBase = `http://${host}:5000/api`;
  const canEditInventory = user?.role === 'rajeshwari';

  const [pendingQueue, setPendingQueue] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState('');
  const [showInvModal, setShowInvModal] = useState(false);
  const [invForm, setInvForm] = useState(defaultInventoryForm);
  const [consultationFee, setConsultationFee] = useState(minimumConsultationFee);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [eodReport, setEodReport] = useState({ transactions: [], cashTotal: 0, upiTotal: 0, grandTotal: 0 });
  const [outPatientForm, setOutPatientForm] = useState({ ...defaultOutPatient, patient: null });
  const [outPatientSearchQuery, setOutPatientSearchQuery] = useState('');
  const [outPatientSearchResults, setOutPatientSearchResults] = useState([]);
  const [walkInMeds, setWalkInMeds] = useState([]);
  const [walkInPayment, setWalkInPayment] = useState('cash');
  const [users, setUsers] = useState([]);
  const [credentialForm, setCredentialForm] = useState({ userId: '', currentPassword: '', newPassword: '', newUsername: '' });

  useEffect(() => {
    fetchPendingQueue();
    fetchInventory();
    fetchEodReport(reportDate);
  }, []);

  useEffect(() => {
    const q = outPatientSearchQuery.trim();
    if (!q) {
      setOutPatientSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/patients/search?q=${encodeURIComponent(q)}`);
        setOutPatientSearchResults(await res.json());
      } catch {
        setOutPatientSearchResults([]);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [apiBase, outPatientSearchQuery]);

  useEffect(() => {
    if (!selectedRx) return;
    setConsultationFee(normalizePayload(selectedRx).consultationFee);
  }, [selectedRx]);

  useEffect(() => {
    if (!wsMessage) return;
    if (wsMessage.type === 'NEW_PRESCRIPTION') {
      setPendingQueue((current) => current.some((rx) => rx.id === wsMessage.data.id) ? current : [...current, wsMessage.data]);
    }
    if (wsMessage.type === 'PRESCRIPTION_UPDATED') {
      const update = wsMessage.data;
      setPendingQueue((current) => update.status === 'billed'
        ? current.filter((rx) => rx.id !== update.id)
        : current.map((rx) => (rx.id === update.id ? { ...rx, status: update.status } : rx)));
      if (selectedRx?.id === update.id) setSelectedRx((current) => (current ? { ...current, status: update.status } : current));
      fetchInventory();
      fetchEodReport(reportDate);
    }
    clearWsMessage();
  }, [wsMessage]);

  const fetchPendingQueue = async () => {
    const response = await fetch(`${apiBase}/prescriptions/pending`);
    const data = await response.json();
    setPendingQueue(data.filter((rx) => rx.status !== 'billed'));
  };

  const fetchInventory = async () => {
    const response = await fetch(`${apiBase}/inventory?search=${encodeURIComponent(inventorySearch)}&filter=${encodeURIComponent(inventoryFilter)}`);
    setInventory(await response.json());
  };

  const fetchEodReport = async (date) => {
    const response = await fetch(`${apiBase}/reports/eod?date=${date}`);
    const data = await response.json();
    setEodReport(data);
    setSelectedTransaction(null);
  };

  const fetchUsers = async () => {
    const response = await fetch(`${apiBase}/users`);
    setUsers(await response.json());
  };

  const medicineUnitPrice = (name) => Number(inventory.find((item) => item.name.toLowerCase() === (name || '').toLowerCase())?.unit_price || 0);

  const calculateMedicineTotal = (medicines) => medicines.reduce((sum, medicine) => {
    const quantity = Number(medicine.quantity || medicine.duration || 1);
    return sum + (medicineUnitPrice(medicine.name) * quantity);
  }, 0);

  const openPrescription = (rx) => {
    setSelectedRx(rx);
    setPaymentMethod('cash');
    setConsultationFee(normalizePayload(rx).consultationFee);
  };

  const handleVerifyPrescription = async (rxId) => {
    const response = await fetch(`${apiBase}/prescriptions/${rxId}/verify`, { method: 'PUT' });
    if (!response.ok) {
      alert('Verification failed.');
      return;
    }
    await fetchPendingQueue();
    if (selectedRx?.id === rxId) setSelectedRx({ ...selectedRx, status: 'verified' });
  };

  const handleGenerateBill = async () => {
    if (!selectedRx) return;
    const payload = normalizePayload(selectedRx);
    const medicineTotal = calculateMedicineTotal(payload.medicines);
    const totalAmount = medicineTotal + consultationFee;

    const response = await fetch(`${apiBase}/bills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prescription_id: selectedRx.id,
        patient_name: selectedRx.patient_name,
        patient_id: selectedRx.patient_id,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        verified_by: user.username,
        details: {
          consultation_fee: consultationFee
        }
      })
    });

    if (!response.ok) {
      alert('Billing transaction failed.');
      return;
    }

    setSelectedRx(null);
    await fetchPendingQueue();
    await fetchInventory();
    await fetchEodReport(reportDate);
  };

  const saveInventoryItem = async (event) => {
    event.preventDefault();
    const method = invForm.id ? 'PUT' : 'POST';
    const endpoint = invForm.id ? `${apiBase}/inventory/${invForm.id}` : `${apiBase}/inventory`;
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invForm)
    });
    if (!response.ok) {
      alert('Failed to save inventory item.');
      return;
    }
    setShowInvModal(false);
    setInvForm(defaultInventoryForm);
    await fetchInventory();
  };

  const deleteInventoryItem = async (id) => {
    if (!window.confirm('Delete this medicine?')) return;
    const response = await fetch(`${apiBase}/inventory/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      alert('Delete failed.');
      return;
    }
    await fetchInventory();
  };

  const addWalkInMedicine = () => {
    if (!outPatientForm.medicine) return;
    const quantity = Number(outPatientForm.quantity || 1);
    const matched = inventory.find((item) => item.name === outPatientForm.medicine);
    setWalkInMeds((current) => [...current, {
      name: outPatientForm.medicine,
      quantity,
      unit_price: Number(matched?.unit_price || 0)
    }]);
    setOutPatientForm({ ...outPatientForm, medicine: '', quantity: '1' });
  };

  const handleSelectOutPatient = (patient) => {
    // patient shape from /patients/search
    setOutPatientForm((cur) => ({
      ...cur,
      patient,
      name: patient.name || '',
      mobile: patient.mobile || patient.contact || ''
    }));
    setOutPatientSearchQuery('');
    setOutPatientSearchResults([]);
  };

  const saveWalkInBill = async () => {
    const totalAmount = walkInMeds.reduce((sum, medicine) => sum + (Number(medicine.unit_price) * Number(medicine.quantity)), 0);

    const patientId = outPatientForm.patient?.id || 'OUTPATIENT';
    const patientName = outPatientForm.name || outPatientForm.patient?.name || 'Walk-in';

    const response = await fetch(`${apiBase}/bills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prescription_id: null,
        patient_name: patientName,
        patient_id: patientId,
        total_amount: totalAmount,
        payment_method: walkInPayment,
        verified_by: user.username,
        source_type: 'outpatient',
        medicines: { medicines: walkInMeds },
        details: {
          patient: {
            name: patientName,
            mobile: outPatientForm.mobile || outPatientForm.patient?.mobile || outPatientForm.patient?.contact || ''
          },
          consultation_fee: 0
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      alert(err.detail || 'Walk-in bill failed.');
      return;
    }

    setWalkInMeds([]);
    setOutPatientForm({ ...defaultOutPatient, patient: null });
    setOutPatientSearchQuery('');
    setOutPatientSearchResults([]);
    await fetchInventory();
    await fetchEodReport(reportDate);
  };

  const updateCredential = async (event) => {
    event.preventDefault();
    if (!credentialForm.userId) return;

    const passwordResponse = await fetch(`${apiBase}/users/${credentialForm.userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: credentialForm.currentPassword, new_password: credentialForm.newPassword })
    });
    if (!passwordResponse.ok) {
      alert('Password update failed.');
      return;
    }

    if (credentialForm.newUsername) {
      const usernameResponse = await fetch(`${apiBase}/users/${credentialForm.userId}/username`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: credentialForm.currentPassword, new_username: credentialForm.newUsername })
      });
      if (!usernameResponse.ok) {
        alert('Username update failed.');
        return;
      }
    }

    setCredentialForm({ userId: '', currentPassword: '', newPassword: '', newUsername: '' });
    await fetchUsers();
  };

  const formatDateDDMMYYYY = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  const renderCaseSheet = (rx) => {
    if (!rx) return null;
    const payload = normalizePayload(rx);

    // dd-mm-yyyy everywhere for this view
    const rxDate = formatDateDDMMYYYY(payload.prescriptionDate);

    return (
      <div className="prescription-print-sheet">
        <div className="case-sheet-card" style={{ padding: '1.25rem 1.5rem', border: '1px solid var(--border-color)', borderRadius: 12 }}>
          {/* Header (matches screenshot style conceptually) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-color)' }}>Prescription Paper</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 2 }}>Verification & Billing</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}><strong>Date</strong></div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--primary-color)' }}>{rxDate || '-'}</div>
            </div>
          </div>

          {/* Body (no Chief Complaints / Diagnosis) */}
          <div className="case-sheet-grid">
            <div><strong>Name</strong><span>{rx.patient_name || '-'}</span></div>
            <div><strong>Regn. No.</strong><span>{rx.patient_regn_no || rx.patient_id || '-'}</span></div>
            <div><strong>Age / Sex</strong><span>{rx.patient_age} / {rx.patient_gender}</span></div>
            <div><strong>Mobile No.</strong><span>{rx.patient_mobile || '-'}</span></div>
            <div><strong>Address</strong><span>{rx.patient_address || '-'}</span></div>
            <div><strong>Weight</strong><span>{rx.patient_weight || '-'}</span></div>
          </div>

          <div className="case-sheet-grid" style={{ marginTop: '1rem' }}>
            {Object.entries(payload.vitals).map(([key, value]) => (
              <div key={key}><strong>{key.toUpperCase()}</strong><span>{value || '-'}</span></div>
            ))}
            <div><strong>PULSE</strong><span>{payload.clinicalFindings.pulse || '-'}</span></div>
            <div><strong>B.P.</strong><span>{payload.clinicalFindings.bp || '-'}</span></div>
          </div>

          {/* Prescription table */}
          <table className="medicine-table">
            <thead>
              <tr>
                <th>Sl. No.</th>
                <th>Name of the Medicine</th>
                <th>Strength</th>
                <th>M</th>
                <th>A</th>
                <th>E</th>
                <th>N</th>
                <th>SOS</th>
                <th>Duration</th>
                <th>Remarks</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {payload.medicines.map((medicine, index) => {
                const quantity = Number(medicine.quantity || medicine.duration || 1);
                return (
                  <tr key={`${medicine.name}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{medicine.name || '-'}</td>
                    <td>{medicine.strength || '-'}</td>
                    {frequencyKeys.map((key) => <td key={key}>{medicine.frequency?.[key] ? 'Yes' : '-'}</td>)}
                    <td>{medicine.duration || '-'}</td>
                    <td>{medicine.remarks || '-'}</td>
                    <td>Rs. {(medicineUnitPrice(medicine.name) * quantity).toFixed(2)}</td>
                  </tr>
                );
              })}

              {/* 10 medicine gap at bottom (blank rows) */}
              {Array.from({ length: 10 }).map((_, idx) => (
                <tr key={`blank-${idx}`}>
                  <td>{payload.medicines.length + idx + 1}</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  {frequencyKeys.map((key) => (
                    <td key={`${idx}-${key}`}>&nbsp;</td>
                  ))}
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Removed patient signature area */}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
      <aside className="sidebar">
        <div className="sidebar-menu">
          <div onClick={() => setActiveTab('inventory')} className={`sidebar-tab ${activeTab === 'inventory' ? 'active' : ''}`}><span>Medicine Inventory</span></div>
          <div onClick={() => setActiveTab('billing_queue')} className={`sidebar-tab ${activeTab === 'billing_queue' ? 'active' : ''}`}><span>Verification & Billing</span></div>
          <div onClick={() => setActiveTab('outpatient')} className={`sidebar-tab ${activeTab === 'outpatient' ? 'active' : ''}`}><span>Out Patient</span></div>
          <div onClick={() => setActiveTab('reports')} className={`sidebar-tab ${activeTab === 'reports' ? 'active' : ''}`}><span>Daily Ledger Report</span></div>
          {canEditInventory && <div onClick={() => setActiveTab('credentials')} className={`sidebar-tab ${activeTab === 'credentials' ? 'active' : ''}`}><span>Account / Credentials</span></div>}
        </div>
        <div className="sidebar-footer">
          <div>{canEditInventory ? 'Rajeshwari Console' : 'Pharmacist Console'}</div>
          <div style={{ opacity: 0.6 }}>{canEditInventory ? 'Inventory + billing access' : 'Billing + inventory view only'}</div>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'inventory' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h2>Medicine Inventory</h2>
                <p style={{ color: '#667085', fontSize: '0.9rem' }}>Search by medicine name, filter expiring stock, and surface low stock quickly.</p>
              </div>
              {canEditInventory && <button className="btn btn-primary" onClick={() => { setInvForm(defaultInventoryForm); setShowInvModal(true); }}>Register Medicine</button>}
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <input className="form-input" style={{ flex: 1, minWidth: '240px' }} placeholder="Search medicine name" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} />
              <select className="form-input" style={{ width: '220px' }} value={inventoryFilter} onChange={(event) => setInventoryFilter(event.target.value)}>
                <option value="">All medicines</option>
                <option value="expiring">Expiring soonest</option>
                <option value="low">Low stock quantity</option>
              </select>
              <button className="btn btn-secondary" onClick={fetchInventory}>Apply</button>
            </div>
            <table className="medicine-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Medicine</th>
                  <th>Molecule</th>
                  <th>Batch</th>
                  <th>Manufacturer</th>
                  <th>Dosage</th>
                  <th>Stock</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => {
                  const daysToExpiry = getDaysToExpiry(item.expiry_date);
                  const expiringSoon = daysToExpiry !== null && daysToExpiry < 60;
                  return (
                    <tr key={item.id}>
                      <td>#{item.id}</td>
                      <td style={{ fontWeight: 600 }}>{item.name}</td>
                      <td>{item.molecule || '-'}</td>
                      <td>{item.batch_number || '-'}</td>
                      <td>{item.manufacturer || '-'}</td>
                      <td>{item.dosage || '-'}</td>
                      <td style={{ color: Number(item.stock_quantity) < 50 ? '#b42318' : 'inherit', fontWeight: 600 }}>{item.stock_quantity}{Number(item.stock_quantity) < 50 ? ' low' : ''}</td>
                      <td style={{ color: expiringSoon ? '#b42318' : 'inherit' }}>{item.expiry_date || '-'}{expiringSoon ? ` (${daysToExpiry}d)` : ''}</td>
                      <td>
                        {canEditInventory ? (
                          <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => { setInvForm(item); setShowInvModal(true); }}>Edit</button>
                            <button className="btn btn-danger" onClick={() => deleteInventoryItem(item.id)}>Delete</button>
                          </div>
                        ) : 'View only'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'billing_queue' && (
          <div className="prescription-workspace">
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginBottom: '1rem' }}>Verification Queue</h3>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {pendingQueue.map((rx) => (
                  <button
                    key={rx.id}
                    type="button"
                    onClick={() => openPrescription(rx)}
                    style={{ textAlign: 'left', border: '1px solid #eaecf0', borderRadius: '10px', background: selectedRx?.id === rx.id ? '#fff4f4' : 'white', padding: '1rem', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <strong>{rx.patient_name}</strong>
                      <span>{rx.status}</span>
                    </div>
                    <div style={{ color: '#667085', fontSize: '0.88rem' }}>{rx.patient_id} | {normalizePayload(rx).medicines.length} medicines</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              {selectedRx ? (
                <div className="card" style={{ marginBottom: 0 }}>
                  <h3 style={{ marginBottom: '1rem' }}>Verification & Billing</h3>
                  {renderCaseSheet(selectedRx)}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    <strong>Consultation Fee</strong>
                    <button className="btn btn-secondary" type="button" onClick={() => setConsultationFee((current) => Math.max(minimumConsultationFee, current - consultationStep))}>- 50</button>
                    <div className="fee-display">Rs. {consultationFee}</div>
                    <button className="btn btn-secondary" type="button" onClick={() => setConsultationFee((current) => current + consultationStep)}>+ 50</button>
                  </div>
                  <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Medicine total</span><strong>Rs. {calculateMedicineTotal(normalizePayload(selectedRx).medicines).toFixed(2)}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Consultation fee</span><strong>Rs. {consultationFee.toFixed(2)}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem' }}><span>Grand total</span><strong>Rs. {(calculateMedicineTotal(normalizePayload(selectedRx).medicines) + consultationFee).toFixed(2)}</strong></div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                    <button className={`btn ${paymentMethod === 'cash' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPaymentMethod('cash')}>Cash</button>
                    <button className={`btn ${paymentMethod === 'upi' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPaymentMethod('upi')}>UPI</button>
                  </div>
                  <div style={{ marginTop: '1rem' }}>
                    {selectedRx.status === 'sent' ? (
                      <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleVerifyPrescription(selectedRx.id)}>Verify Prescription</button>
                    ) : (
                      <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleGenerateBill}>Complete Billing</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px', color: '#98a2b3' }}>
                  Select a prescription to review the case-sheet bill.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'outpatient' && (
          <div className="card">
            <h2>Out Patient</h2>
            <p style={{ color: '#667085', fontSize: '0.9rem', marginBottom: '1rem' }}>Select an existing patient (optional) and add medicines for billing.</p>

            <div className="form-row">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>Patient (Type & Select)</label>
                <div className="search-input-wrapper" style={{ marginTop: 6 }}>
                  <span className="search-icon">Search</span>
                  <input
                    type="text"
                    className="search-field"
                    placeholder="Type patient name / mobile / reg no"
                    value={outPatientSearchQuery}
                    onChange={(e) => setOutPatientSearchQuery(e.target.value)}
                  />
                </div>
                {outPatientSearchResults.length > 0 && (
                  <div className="autocomplete-popup">
                    {outPatientSearchResults.map((patient) => (
                      <div
                        key={patient.id}
                        className="autocomplete-item"
                        onClick={() => handleSelectOutPatient(patient)}
                      >
                        <div>
                          <div>
                            <span className="autocomplete-name">{patient.name}</span>
                            <span style={{ marginLeft: '0.5rem', color: '#667085', fontSize: '0.82rem' }}>
                              {patient.age}y / {patient.gender}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.82rem', color: '#667085' }}>
                            {patient.mobile || patient.contact || '-'} | Reg: {patient.regn_no || patient.id}
                          </div>
                        </div>
                        <span className="autocomplete-id">{patient.regn_no || patient.id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input className="form-input" value={outPatientForm.name} onChange={(event) => setOutPatientForm({ ...outPatientForm, name: event.target.value })} />
              </div>
              <div className="form-group">
                <label>Mobile / Basic Info</label>
                <input className="form-input" value={outPatientForm.mobile} onChange={(event) => setOutPatientForm({ ...outPatientForm, mobile: event.target.value })} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Medicine</label>
                <select className="form-input" value={outPatientForm.medicine} onChange={(event) => setOutPatientForm({ ...outPatientForm, medicine: event.target.value })}>
                  <option value="">Select medicine</option>
                  {inventory.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Quantity</label>
                <input className="form-input" type="number" min="1" value={outPatientForm.quantity} onChange={(event) => setOutPatientForm({ ...outPatientForm, quantity: event.target.value })} />
              </div>
            </div>
            <button className="btn btn-secondary" onClick={addWalkInMedicine}>Add Medicine</button>

            <table className="medicine-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Qty</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {walkInMeds.map((medicine, index) => (
                  <tr key={`${medicine.name}-${index}`}>
                    <td>{medicine.name}</td>
                    <td>{medicine.quantity}</td>
                    <td>Rs. {(Number(medicine.unit_price) * Number(medicine.quantity)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <button className={`btn ${walkInPayment === 'cash' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setWalkInPayment('cash')}>Cash</button>
              <button className={`btn ${walkInPayment === 'upi' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setWalkInPayment('upi')}>UPI</button>
            </div>
            <button className="btn btn-primary" onClick={saveWalkInBill}>Generate Bill</button>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="card">
            <h2>Daily Ledger Report</h2>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', margin: '1rem 0', flexWrap: 'wrap' }}>
              <label>Date</label>
              <input type="date" className="form-input" style={{ width: '220px' }} value={reportDate} onChange={(event) => { setReportDate(event.target.value); fetchEodReport(event.target.value); }} />
            </div>
            <div className="stats-row">
              <div className="stat-card"><span className="stat-title">Cash Revenue</span><span className="stat-value cash">Rs. {eodReport.cashTotal.toFixed(2)}</span></div>
              <div className="stat-card"><span className="stat-title">UPI Revenue</span><span className="stat-value upi">Rs. {eodReport.upiTotal.toFixed(2)}</span></div>
              <div className="stat-card"><span className="stat-title">Grand Total</span><span className="stat-value">Rs. {eodReport.grandTotal.toFixed(2)}</span></div>
            </div>
            <div className="prescription-workspace">
              <div className="card" style={{ marginBottom: 0 }}>
                <h3 style={{ marginBottom: '1rem' }}>Transaction Breakdown</h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {eodReport.transactions.map((tx) => (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => setSelectedTransaction(tx)}
                      style={{ textAlign: 'left', border: '1px solid #eaecf0', borderRadius: '10px', background: selectedTransaction?.id === tx.id ? '#fff4f4' : 'white', padding: '1rem', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <strong>{tx.patient_name}</strong>
                        <span>Rs. {Number(tx.total_amount).toFixed(2)}</span>
                      </div>
                      <div style={{ color: '#667085', fontSize: '0.88rem' }}>{tx.patient_id} | {tx.payment_method} | {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="card" style={{ marginBottom: 0 }}>
                  <h3 style={{ marginBottom: '1rem' }}>Selected Transaction</h3>
                  {selectedTransaction ? (
                    <div>
                      <div style={{ marginBottom: '1rem' }}>
                        <div><strong>Patient:</strong> {selectedTransaction.patient_name}</div>
                        <div><strong>Payment:</strong> {selectedTransaction.payment_method}</div>
                        <div><strong>Total:</strong> Rs. {Number(selectedTransaction.total_amount).toFixed(2)}</div>
                      </div>
                      <table className="medicine-table">
                        <thead>
                          <tr>
                            <th>Medicine</th>
                            <th>Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedTransaction.medicines || []).map((medicine, index) => (
                            <tr key={`${medicine.name}-${index}`}>
                              <td>{medicine.name || '-'}</td>
                              <td>{medicine.quantity || medicine.duration || 1}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ color: '#98a2b3' }}>Click a patient entry to see only that transaction's medicine list.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'credentials' && canEditInventory && (
          <div className="card">
            <h2>Account / Credential Management</h2>
            <p style={{ color: '#667085', fontSize: '0.9rem' }}>Change usernames and passwords for the Doctor, Pharmacist, and Rajeshwari accounts. Current password is required.</p>
            <button className="btn btn-secondary" style={{ margin: '1rem 0' }} onClick={fetchUsers}>Load Accounts</button>
            {users.length > 0 && (
              <table className="medicine-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Username</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.id}</td>
                      <td>{entry.username}</td>
                      <td>{entry.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={updateCredential} style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
              <select className="form-input" value={credentialForm.userId} onChange={(event) => setCredentialForm({ ...credentialForm, userId: event.target.value })}>
                <option value="">Select account</option>
                {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.username} ({entry.role})</option>)}
              </select>
              <input className="form-input" type="password" placeholder="Current password" value={credentialForm.currentPassword} onChange={(event) => setCredentialForm({ ...credentialForm, currentPassword: event.target.value })} />
              <input className="form-input" type="password" placeholder="New password" value={credentialForm.newPassword} onChange={(event) => setCredentialForm({ ...credentialForm, newPassword: event.target.value })} />
              <input className="form-input" placeholder="New username (optional)" value={credentialForm.newUsername} onChange={(event) => setCredentialForm({ ...credentialForm, newUsername: event.target.value })} />
              <button className="btn btn-primary" type="submit">Save Credentials</button>
            </form>
          </div>
        )}
      </main>

      {showInvModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginBottom: '1rem' }}>{invForm.id ? 'Edit Medicine' : 'Register Medicine'}</h3>
            <form onSubmit={saveInventoryItem}>
              <div className="form-group"><label>Medicine Name</label><input className="form-input" required value={invForm.name} onChange={(event) => setInvForm({ ...invForm, name: event.target.value })} /></div>
              <div className="form-row">
                <div className="form-group"><label>Stock Quantity</label><input className="form-input" type="number" min="0" value={invForm.stock_quantity} onChange={(event) => setInvForm({ ...invForm, stock_quantity: event.target.value })} /></div>
                <div className="form-group"><label>Unit Price</label><input className="form-input" type="number" min="0" step="0.01" value={invForm.unit_price} onChange={(event) => setInvForm({ ...invForm, unit_price: event.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Molecule / Composition</label><input className="form-input" value={invForm.molecule} onChange={(event) => setInvForm({ ...invForm, molecule: event.target.value })} /></div>
                <div className="form-group"><label>Batch Number</label><input className="form-input" value={invForm.batch_number} onChange={(event) => setInvForm({ ...invForm, batch_number: event.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Manufacturer</label><input className="form-input" value={invForm.manufacturer} onChange={(event) => setInvForm({ ...invForm, manufacturer: event.target.value })} /></div>
                <div className="form-group"><label>Dosage</label><input className="form-input" value={invForm.dosage} onChange={(event) => setInvForm({ ...invForm, dosage: event.target.value })} /></div>
              </div>
              <div className="form-group"><label>Expiry Date</label><input className="form-input" type="date" value={invForm.expiry_date} onChange={(event) => setInvForm({ ...invForm, expiry_date: event.target.value })} /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button className="btn btn-secondary" type="button" onClick={() => setShowInvModal(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
