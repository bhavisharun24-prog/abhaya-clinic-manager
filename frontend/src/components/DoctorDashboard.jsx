import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

export default function DoctorDashboard() {
  const { activeTab, setActiveTab } = useContext(AppContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  
  // Register Patient Form State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: '', age: '', gender: 'Male', contact: '', medical_history: '', photo: null
  });
  const [photoPreview, setPhotoPreview] = useState(null);

  // Prescription Workspace State
  const [prescriptionMeds, setPrescriptionMeds] = useState([]);
  const [consultationFee, setConsultationFee] = useState(0);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [attachedImage, setAttachedImage] = useState(null);
  const [attachedImagePreview, setAttachedImagePreview] = useState(null);
  
  // Add Medicine Form State
  const [inventory, setInventory] = useState([]);
  const [medQuery, setMedQuery] = useState('');
  const [filteredMeds, setFilteredMeds] = useState([]);
  const [currentMed, setCurrentMed] = useState({ name: '', dosage: '1-0-1', frequency: 'After Meal', duration: '5' });

  // Frequent/Recent Patients state
  const [frequentPatients, setFrequentPatients] = useState([]);

  // Fetch Inventory and Frequent patients on load
  const host = window.location.hostname || '127.0.0.1';

  useEffect(() => {
    fetchInventory();
    fetchFrequentPatients();
  }, []);

  const fetchInventory = async () => {
    try {
      const res = await fetch(`http://${host}:5000/api/inventory`);
      const data = await res.json();
      setInventory(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchFrequentPatients = async () => {
    try {
      const res = await fetch(`http://${host}:5000/api/reports/frequent-visits`);
      const data = await res.json();
      setFrequentPatients(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Autocomplete patient search
  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`http://${host}:5000/api/patients/search?q=${searchQuery}`);
        const data = await res.json();
        setSearchResults(data);
      } catch (err) {
        console.error(err);
      }
    }, 150);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Select a patient
  const handleSelectPatient = async (patientId) => {
    try {
      const res = await fetch(`http://${host}:5000/api/patients/${patientId}`);
      const data = await res.json();
      setSelectedPatient(data);
      setSearchQuery('');
      setSearchResults([]);
      
      // Load/Pre-fill prescription from their latest visit
      if (data.latestPrescription) {
        setPrescriptionMeds(data.latestPrescription.medicines || []);
        setConsultationFee(data.latestPrescription.consultation_fee || 0);
      } else {
        // Reset workspace for new patients
        setPrescriptionMeds([]);
        setConsultationFee(0);
      }
      setDoctorNotes('');
      setAttachedImage(null);
      setAttachedImagePreview(null);

      // Default to Patient Details tab
      setActiveTab('patients');
    } catch (err) {
      console.error(err);
    }
  };

  // Register new patient
  const handleRegisterPatient = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', newPatient.name);
    formData.append('age', newPatient.age);
    formData.append('gender', newPatient.gender);
    formData.append('contact', newPatient.contact);
    formData.append('medical_history', newPatient.medical_history);
    if (newPatient.photo) {
      formData.append('photo', newPatient.photo);
    }

    try {
      const res = await fetch(`http://${host}:5000/api/patients`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register patient');

      // Select newly registered patient
      handleSelectPatient(data.id);
      
      // Close modal & reset
      setShowRegisterModal(false);
      setNewPatient({ name: '', age: '', gender: 'Male', contact: '', medical_history: '', photo: null });
      setPhotoPreview(null);
      fetchFrequentPatients();
    } catch (err) {
      alert(err.message);
    }
  };

  // Document upload inside Patient details tab
  const handleDocumentUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedPatient) return;

    const formData = new FormData();
    formData.append('document', file);

    try {
      const res = await fetch(`http://${host}:5000/api/patients/${selectedPatient.patient.id}/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Upload failed');
      
      // Refresh patient details to update document history/list
      // In this version, we append the uploaded document path to the patient's record 
      // (For this mock we can display an alert or save it in state)
      alert(`Document uploaded successfully: ${file.name}`);
    } catch (err) {
      alert(err.message);
    }
  };

  // Medicine autocomplete filters
  const handleMedQueryChange = (val) => {
    setMedQuery(val);
    if (!val.trim()) {
      setFilteredMeds([]);
      return;
    }
    const filtered = inventory.filter(m => m.name.toLowerCase().includes(val.toLowerCase()));
    setFilteredMeds(filtered);
  };

  const handleSelectMed = (medName) => {
    setCurrentMed({ ...currentMed, name: medName });
    setMedQuery(medName);
    setFilteredMeds([]);
  };

  // Add medicine to prescription list
  const handleAddMedicine = () => {
    if (!currentMed.name) {
      alert("Please enter or select a medicine name.");
      return;
    }
    setPrescriptionMeds([...prescriptionMeds, currentMed]);
    setCurrentMed({ name: '', dosage: '1-0-1', frequency: 'After Meal', duration: '5' });
    setMedQuery('');
  };

  // Delete medicine from current prescription
  const handleRemoveMedicine = (index) => {
    setPrescriptionMeds(prescriptionMeds.filter((_, i) => i !== index));
  };

  // Consultation Fee Counter adjustments
  const adjustFee = (amount) => {
    setConsultationFee(prev => Math.max(0, prev + amount));
  };

  // Finalize Prescription & push over WebSocket
  const handleFinalizePrescription = async () => {
    if (!selectedPatient) return;
    if (prescriptionMeds.length === 0 && !doctorNotes) {
      alert("Please add medicines or write notes to save prescription.");
      return;
    }

    const formData = new FormData();
    formData.append('patient_id', selectedPatient.patient.id);
    formData.append('doctor_notes', doctorNotes);
    formData.append('medicines', JSON.stringify(prescriptionMeds));
    formData.append('consultation_fee', consultationFee);
    if (attachedImage) {
      formData.append('prescription_image', attachedImage);
    }

    try {
      const res = await fetch(`http://${host}:5000/api/prescriptions`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error("Failed to submit prescription");
      
      alert("Prescription finalized and pushed to the pharmacist!");
      
      // Reload patient details to update visit history
      handleSelectPatient(selectedPatient.patient.id);
      fetchFrequentPatients();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-menu">
          <div 
            onClick={() => selectedPatient && setActiveTab('patients')} 
            className={`sidebar-tab ${activeTab === 'patients' ? 'active' : ''} ${!selectedPatient ? 'disabled' : ''}`}
            style={{ opacity: selectedPatient ? 1 : 0.45 }}
          >
            <span>Patient Details</span>
          </div>
          <div 
            onClick={() => selectedPatient && setActiveTab('prescriptions')} 
            className={`sidebar-tab ${activeTab === 'prescriptions' ? 'active' : ''} ${!selectedPatient ? 'disabled' : ''}`}
            style={{ opacity: selectedPatient ? 1 : 0.45 }}
          >
            <span>Prescription Workspace</span>
          </div>
          <div 
            onClick={() => selectedPatient && setActiveTab('previous_visits')} 
            className={`sidebar-tab ${activeTab === 'previous_visits' ? 'active' : ''} ${!selectedPatient ? 'disabled' : ''}`}
            style={{ opacity: selectedPatient ? 1 : 0.45 }}
          >
            <span>Previous Visits</span>
          </div>
        </div>
        <div className="sidebar-footer">
          <div>System 1 — Doctor PC</div>
          <div style={{ opacity: 0.6 }}>Offline Server Instance</div>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
        {/* Prominent Autocomplete Search Bar */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem' }}>
          <div className="search-container" style={{ flex: 1, marginBottom: 0 }}>
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                placeholder="Search patient by ID (e.g. A001) or name..." 
                className="search-field"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            {searchResults.length > 0 && (
              <div className="autocomplete-popup">
                {searchResults.map(p => (
                  <div key={p.id} className="autocomplete-item" onClick={() => handleSelectPatient(p.id)}>
                    <div>
                      <span className="autocomplete-name">{p.name}</span>
                      <span style={{ fontSize: '0.8rem', color: '#667085', marginLeft: '8px' }}>({p.age}y, {p.gender})</span>
                    </div>
                    <span className="autocomplete-id">{p.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>
            + New Patient
          </button>
        </div>

        {/* If no patient is selected, display dashboard home with frequent patients */}
        {!selectedPatient ? (
          <div>
            <div style={{
              background: 'linear-gradient(135deg, #101b42 0%, #1e295d 100%)',
              color: 'white',
              padding: '2.5rem',
              borderRadius: '16px',
              boxShadow: 'var(--shadow-md)',
              marginBottom: '2.5rem'
            }}>
              <h2 style={{ color: 'white', fontSize: '1.8rem', marginBottom: '8px' }}>Welcome, Dr. Raveesha .A</h2>
              <p style={{ opacity: 0.85, fontSize: '0.95rem' }}>Look up a patient using the search bar above or check the frequent visits list to start consultation.</p>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '1.25rem' }}>Frequent / Chronic Patients</h3>
              {frequentPatients.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#667085', padding: '2rem' }}>
                  No patients registered yet. Click "+ New Patient" to begin.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                  {frequentPatients.map(p => (
                    <div 
                      key={p.id} 
                      onClick={() => handleSelectPatient(p.id)}
                      style={{
                        padding: '1.2rem',
                        border: '1px solid #eaecf0',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        backgroundColor: 'white'
                      }}
                      className="hover-card-effects"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#d9383a';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#eaecf0';
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 700, color: '#101b42' }}>{p.name}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', backgroundColor: '#f2f4f7', padding: '2px 6px', borderRadius: '4px' }}>{p.id}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#667085' }}>
                        <div>{p.age} Yrs • {p.gender}</div>
                        <div>Contact: {p.contact}</div>
                      </div>
                      <div style={{
                        marginTop: '12px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#d9383a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        🔄 Total Visits: {p.visit_count}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            {/* Quick Patient Details Header Bar */}
            <div className="info-banner">
              <div className="info-grid">
                <div>
                  <div className="info-label">Patient Name</div>
                  <div className="info-value">{selectedPatient.patient.name}</div>
                </div>
                <div>
                  <div className="info-label">Patient ID</div>
                  <div className="info-value" style={{ fontFamily: 'monospace' }}>{selectedPatient.patient.id}</div>
                </div>
                <div>
                  <div className="info-label">Age & Gender</div>
                  <div className="info-value">{selectedPatient.patient.age} Yrs / {selectedPatient.patient.gender}</div>
                </div>
                <div>
                  <div className="info-label">Contact</div>
                  <div className="info-value">{selectedPatient.patient.contact}</div>
                </div>
              </div>
            </div>

            {/* Render Tab Contents */}
            {activeTab === 'patients' && (
              <div className="card">
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  {/* Photo & Files column */}
                  <div style={{ width: '220px', textAlign: 'center' }}>
                    <div style={{
                      width: '100%',
                      height: '220px',
                      borderRadius: '12px',
                      backgroundColor: '#f2f4f7',
                      border: '2px dashed #d0d5dd',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      marginBottom: '1rem'
                    }}>
                      {selectedPatient.patient.photo_path ? (
                        <img 
                          src={`http://${host}:5000${selectedPatient.patient.photo_path}`} 
                          alt="Patient Profile" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span style={{ fontSize: '3rem', color: '#94a3b8' }}>👤</span>
                      )}
                    </div>
                    
                    <label className="btn btn-secondary" style={{ width: '100%', cursor: 'pointer' }}>
                      📎 Upload Report / ID
                      <input 
                        type="file" 
                        onChange={handleDocumentUpload} 
                        style={{ display: 'none' }} 
                        accept="image/*,.pdf"
                      />
                    </label>
                  </div>

                  {/* Profile info details */}
                  <div style={{ flex: 1, minWidth: '300px' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Patient Profile Card</h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                      <div>
                        <strong style={{ display: 'block', color: '#667085', fontSize: '0.85rem' }}>Medical History</strong>
                        <div style={{
                          padding: '1rem',
                          background: '#f8f9fa',
                          borderRadius: '8px',
                          border: '1px solid #eaecf0',
                          minHeight: '100px',
                          marginTop: '4px',
                          color: '#344054',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {selectedPatient.patient.medical_history || 'No recorded medical history.'}
                        </div>
                      </div>

                      <div>
                        <strong style={{ display: 'block', color: '#667085', fontSize: '0.85rem' }}>Registered At</strong>
                        <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>
                          {new Date(selectedPatient.patient.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'prescriptions' && (
              <div className="prescription-workspace">
                {/* Prescription detail columns */}
                <div className="card" style={{ marginBottom: 0 }}>
                  <h3>New Visit Diagnosis & Medicines</h3>
                  
                  {/* Notes fields */}
                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <label>Doctor's Consultation Notes</label>
                    <textarea 
                      rows="3" 
                      placeholder="Enter chief complaints, diagnosis notes, advice..."
                      className="form-input"
                      value={doctorNotes}
                      onChange={e => setDoctorNotes(e.target.value)}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  {/* Medicines building grid */}
                  <div style={{ border: '1px solid #eaecf0', padding: '1.25rem', borderRadius: '10px', backgroundColor: '#fdfdfd' }}>
                    <h4 style={{ marginBottom: '0.75rem' }}>Add Medicine to Prescription</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                      
                      {/* Name input with inventory autocomplete list */}
                      <div style={{ position: 'relative' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Medicine Name</label>
                        <input 
                          type="text" 
                          placeholder="Search stock..." 
                          className="form-input"
                          value={medQuery}
                          onChange={e => handleMedQueryChange(e.target.value)}
                        />
                        {filteredMeds.length > 0 && (
                          <div className="autocomplete-popup" style={{ width: '100%' }}>
                            {filteredMeds.map(m => (
                              <div key={m.id} className="autocomplete-item" onClick={() => handleSelectMed(m.name)}>
                                <span className="autocomplete-name">{m.name}</span>
                                <span className="autocomplete-id" style={{ backgroundColor: m.stock_quantity > 0 ? '#ecfdf3' : '#fef3f2', color: m.stock_quantity > 0 ? '#027a48' : '#b32318' }}>
                                  Stock: {m.stock_quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Dosage</label>
                        <select 
                          className="form-input" 
                          value={currentMed.dosage}
                          onChange={e => setCurrentMed({ ...currentMed, dosage: e.target.value })}
                        >
                          <option value="1-0-1">1-0-1 (BID)</option>
                          <option value="1-1-1">1-1-1 (TID)</option>
                          <option value="1-0-0">1-0-0 (OD - Morning)</option>
                          <option value="0-0-1">0-0-1 (OD - Night)</option>
                          <option value="1-1-1-1">1-1-1-1 (QID)</option>
                          <option value="PRN">PRN (As needed)</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Frequency</label>
                        <select 
                          className="form-input"
                          value={currentMed.frequency}
                          onChange={e => setCurrentMed({ ...currentMed, frequency: e.target.value })}
                        >
                          <option value="After Meal">After Meal</option>
                          <option value="Before Meal">Before Meal</option>
                          <option value="With Meal">With Meal</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Duration (Days)</label>
                        <input 
                          type="number" 
                          min="1" 
                          className="form-input"
                          value={currentMed.duration}
                          onChange={e => setCurrentMed({ ...currentMed, duration: e.target.value })}
                        />
                      </div>

                      <button type="button" className="btn btn-primary" onClick={handleAddMedicine}>
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Added medicines list */}
                  {prescriptionMeds.length > 0 && (
                    <table className="medicine-table">
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th>Dosage</th>
                          <th>Frequency</th>
                          <th>Duration</th>
                          <th style={{ width: '50px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {prescriptionMeds.map((m, idx) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600, color: '#101b42' }}>{m.name}</td>
                            <td>{m.dosage}</td>
                            <td>{m.frequency}</td>
                            <td>{m.duration} days</td>
                            <td>
                              <button onClick={() => handleRemoveMedicine(idx)} className="btn btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                                🗑️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Prescription sidebar summary column */}
                <div style={{ display: 'grid', gap: '1.5rem', width: '100%' }}>
                  {/* Attached photo workspace */}
                  <div className="card" style={{ marginBottom: 0 }}>
                    <h4 style={{ marginBottom: '0.75rem' }}>Attach Scans/Files</h4>
                    {attachedImagePreview && (
                      <div style={{ width: '100%', height: '140px', overflow: 'hidden', borderRadius: '8px', border: '1px solid #eaecf0', marginBottom: '0.75rem' }}>
                        <img src={attachedImagePreview} alt="Prescription preview" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center bottom' }} />
                      </div>
                    )}
                    <label className="btn btn-secondary" style={{ width: '100%', cursor: 'pointer' }}>
                      📷 Attach Lab/Handwritten File
                      <input 
                        type="file" 
                        onChange={e => {
                          const file = e.target.files[0];
                          if (file) {
                            setAttachedImage(file);
                            setAttachedImagePreview(URL.createObjectURL(file));
                          }
                        }} 
                        style={{ display: 'none' }}
                        accept="image/*"
                      />
                    </label>
                  </div>

                  {/* Consultation Fee adjustment widget */}
                  <div className="card" style={{ marginBottom: 0 }}>
                    <h4 style={{ marginBottom: '0.75rem' }}>Consultation Fee</h4>
                    <div className="fee-control">
                      <button className="btn btn-secondary" onClick={() => adjustFee(-50)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.55rem' }}>
                        -50
                      </button>
                      <div className="fee-display" style={{ fontSize: '0.95rem', padding: '0.2rem 0.45rem' }}>
                        ₹{consultationFee}
                      </div>
                      <button className="btn btn-secondary" onClick={() => adjustFee(50)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.55rem' }}>
                        +50
                      </button>
                    </div>
                  </div>

                  {/* Action submit button */}
                  <button onClick={handleFinalizePrescription} className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', boxShadow: '0 4px 6px rgba(217, 56, 58, 0.2)' }}>
                    ✅ Finalize & Send
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'previous_visits' && (
              <div className="card">
                <h3>Visits History Records</h3>
                {selectedPatient.visits.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#667085', padding: '2rem' }}>
                    No recorded visits for this patient yet.
                  </div>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {selectedPatient.visits.map(v => (
                      <div key={v.id} style={{ border: '1px solid #eaecf0', borderRadius: '10px', padding: '1.25rem', backgroundColor: '#fcfcfd' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px dashed #eaecf0', paddingBottom: '6px' }}>
                          <span style={{ fontWeight: 600, color: '#101b42' }}>Visit #{v.visit_number}</span>
                          <span style={{ color: '#667085', fontSize: '0.85rem' }}>📅 Date: {v.date}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', marginBottom: '8px' }}>
                          <strong>Doctor Notes: </strong>
                          <p style={{ display: 'inline', color: '#344054', fontStyle: 'italic' }}>{v.doctor_notes || 'None'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Register Patient Modal */}
      {showRegisterModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginBottom: '1.5rem' }}>Register New Patient</h3>
            <form onSubmit={handleRegisterPatient}>
              
              <div className="form-group">
                <label>Full Name</label>
                <input 
                  type="text" 
                  required 
                  className="form-input"
                  value={newPatient.name}
                  onChange={e => setNewPatient({ ...newPatient, name: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Age</label>
                  <input 
                    type="number" 
                    required 
                    min="0"
                    max="150"
                    className="form-input"
                    value={newPatient.age}
                    onChange={e => setNewPatient({ ...newPatient, age: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select 
                    className="form-input"
                    value={newPatient.gender}
                    onChange={e => setNewPatient({ ...newPatient, gender: e.target.value })}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Contact Number</label>
                <input 
                  type="tel" 
                  required 
                  className="form-input"
                  value={newPatient.contact}
                  onChange={e => setNewPatient({ ...newPatient, contact: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Medical History</label>
                <textarea 
                  rows="3" 
                  className="form-input"
                  placeholder="Known allergies, chronic conditions, regular medicines..."
                  value={newPatient.medical_history}
                  onChange={e => setNewPatient({ ...newPatient, medical_history: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Patient Photo / ID Proof</label>
                {photoPreview && (
                  <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px', border: '1px solid #eaecf0' }}>
                    <img src={photoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={e => {
                    const file = e.target.files[0];
                    if (file) {
                      setNewPatient({ ...newPatient, photo: file });
                      setPhotoPreview(URL.createObjectURL(file));
                    }
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowRegisterModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register & Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
