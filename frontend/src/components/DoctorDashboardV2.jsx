import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '../App';

const complaintOptions = [
  'Fever',
  'Cough',
  'Cold',
  'Headache',
  'Abdominal pain',
  'Hypertension follow-up',
  'Diabetes follow-up',
  'Back pain',
  'Joint pain',
  'Gastritis/Acidity',
  'Weakness/Fatigue',
  'Dizziness',
  'Urinary tract infection symptoms',
  'Shortness of breath',
  'Skin rashes',
  'Diarrhea and vomiting',
  'Others'
];

const defaultVitals = { spo2: '', rbs: '', fbs: '', ppbs: '', hba1c: '', ecg: '', others: '' };
const defaultClinicalFindings = { pulse: '', bp: '' };
const frequencyKeys = ['m', 'a', 'e', 'n', 'sos'];

const createMedicineRow = () => ({
  name: '',
  strength: '',
  frequency: { m: false, a: false, e: false, n: false, sos: false },
  duration: '',
  remarks: ''
});

const calculateAge = (dob) => {
  if (!dob) return '';
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

const normalizePrescription = (value) => {
  const payload = value?.payload || value || {};
  const medicines = Array.isArray(payload.medicines) ? payload.medicines : [];
  const chiefComplaints = Array.isArray(payload.chief_complaints) ? payload.chief_complaints : [];
  const knownComplaints = chiefComplaints.filter((item) => complaintOptions.includes(item) && item !== 'Others');
  const customComplaints = chiefComplaints.filter((item) => !complaintOptions.includes(item));
  const hasOther = chiefComplaints.includes('Others') || customComplaints.length > 0;

  return {
    medicines: medicines.length ? medicines.map((row) => ({
      ...createMedicineRow(),
      ...row,
      frequency: { ...createMedicineRow().frequency, ...(row.frequency || {}) }
    })) : [createMedicineRow()],
    chiefComplaints: hasOther ? [...knownComplaints, 'Others'] : knownComplaints,
    otherComplaint: customComplaints.join(', '),
    vitals: { ...defaultVitals, ...(payload.vitals || {}) },
    clinicalFindings: { ...defaultClinicalFindings, ...(payload.clinical_findings || {}) },
    diagnosis: payload.diagnosis || '',
    prescriptionDate: payload.prescription_date || new Date().toISOString().slice(0, 10)
  };
};

const caseSheetLabel = (value) => value.toUpperCase();

export default function DoctorDashboardV2() {
  const { activeTab, setActiveTab } = useContext(AppContext);
  const host = window.location.hostname || '127.0.0.1';
  const apiBase = `http://${host}:5000/api`;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [frequentPatients, setFrequentPatients] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [editingPrescriptionId, setEditingPrescriptionId] = useState(null);
  const [prescriptionDate, setPrescriptionDate] = useState(new Date().toISOString().slice(0, 10));
  const [chiefComplaints, setChiefComplaints] = useState([]);
  const [otherComplaint, setOtherComplaint] = useState('');
  const [vitals, setVitals] = useState({ ...defaultVitals });
  const [clinicalFindings, setClinicalFindings] = useState({ ...defaultClinicalFindings });
  const [diagnosis, setDiagnosis] = useState('');
  const [medicationRows, setMedicationRows] = useState([createMedicineRow()]);
  const [attachedImage, setAttachedImage] = useState(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [newPatient, setNewPatient] = useState({
    name: '',
    dob: '',
    gender: 'Male',
    address: '',
    mobile: '',
    weight: '',
    medical_history: '',
    photo: null
  });

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [inventoryRes, frequentRes] = await Promise.all([
          fetch(`${apiBase}/inventory`),
          fetch(`${apiBase}/reports/frequent-visits`)
        ]);
        setInventory(await inventoryRes.json());
        setFrequentPatients(await frequentRes.json());
      } catch (error) {
        console.error(error);
      }
    };
    loadInitial();
  }, [apiBase]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${apiBase}/patients/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(await response.json());
      } catch (error) {
        console.error(error);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [apiBase, searchQuery]);

  const refreshFrequentPatients = async () => {
    const response = await fetch(`${apiBase}/reports/frequent-visits`);
    setFrequentPatients(await response.json());
  };

  const resetPrescriptionForm = (prescription = null) => {
    const normalized = normalizePrescription(prescription);
    setEditingPrescriptionId(null);
    setPrescriptionDate(normalized.prescriptionDate);
    setChiefComplaints(normalized.chiefComplaints);
    setOtherComplaint(normalized.otherComplaint);
    setVitals(normalized.vitals);
    setClinicalFindings(normalized.clinicalFindings);
    setDiagnosis(normalized.diagnosis);
    setMedicationRows(normalized.medicines);
    setAttachedImage(null);
  };

  const handleSelectPatient = async (patientId, nextTab = 'patients') => {
    const response = await fetch(`${apiBase}/patients/${patientId}`);
    const data = await response.json();
    setSelectedPatient(data);
    setDocuments(data.documents || []);
    setSearchQuery('');
    setSearchResults([]);
    resetPrescriptionForm(data.latestPrescription || data.prescriptions?.[0] || null);
    setActiveTab(nextTab);
  };

  const handleRegisterPatient = async (event) => {
    event.preventDefault();
    const age = calculateAge(newPatient.dob);
    if (age === '') {
      alert('Date of birth is required.');
      return;
    }

    const formData = new FormData();
    formData.append('name', newPatient.name);
    formData.append('age', `${age}`);
    formData.append('gender', newPatient.gender);
    formData.append('contact', newPatient.mobile);
    formData.append('dob', newPatient.dob);
    formData.append('address', newPatient.address);
    formData.append('mobile', newPatient.mobile);
    formData.append('weight', newPatient.weight);
    formData.append('medical_history', newPatient.medical_history);
    if (newPatient.photo) formData.append('photo', newPatient.photo);

    const response = await fetch(`${apiBase}/patients`, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) {
      alert(data.detail || 'Failed to register patient.');
      return;
    }

    setShowRegisterModal(false);
    setNewPatient({ name: '', dob: '', gender: 'Male', address: '', mobile: '', weight: '', medical_history: '', photo: null });
    setPhotoPreview(null);
    await refreshFrequentPatients();
    await handleSelectPatient(data.id, 'prescriptions');
  };

  const handleDocumentUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedPatient) return;
    const formData = new FormData();
    formData.append('document', file);
    const response = await fetch(`${apiBase}/patients/${selectedPatient.patient.id}/upload`, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) {
      alert(data.detail || 'Upload failed.');
      return;
    }
    setDocuments(data.documents || []);
  };

  const updatePatientWeight = (weight) => {
    if (!selectedPatient) return;
    setSelectedPatient({
      ...selectedPatient,
      patient: { ...selectedPatient.patient, weight }
    });
  };

  const handleComplaintChange = (event) => {
    setChiefComplaints(Array.from(event.target.selectedOptions).map((option) => option.value));
  };

  const handleMedicineChange = (index, field, value) => {
    setMedicationRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const handleFrequencyChange = (index, key) => {
    setMedicationRows((rows) => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, frequency: { ...row.frequency, [key]: !row.frequency?.[key] } } : row
    )));
  };

  const savePatientWeight = async () => {
    if (!selectedPatient) return;
    await fetch(`${apiBase}/patients/${selectedPatient.patient.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: selectedPatient.patient.weight || '' })
    });
  };

  const submitPrescription = async () => {
    if (!selectedPatient) return;

    await savePatientWeight();

    const cleanedMedicines = medicationRows.filter((row) => row.name || row.strength || row.duration || row.remarks);
    const complaints = chiefComplaints.includes('Others')
      ? [...chiefComplaints.filter((item) => item !== 'Others'), ...otherComplaint.split(',').map((item) => item.trim()).filter(Boolean)]
      : chiefComplaints;

    const payload = {
      medicines: cleanedMedicines,
      consultation_fee: 400,
      chief_complaints: complaints,
      vitals,
      clinical_findings: clinicalFindings,
      diagnosis,
      prescription_date: prescriptionDate
    };

    let response;
    if (editingPrescriptionId) {
      response = await fetch(`${apiBase}/prescriptions/${editingPrescriptionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      const formData = new FormData();
      formData.append('patient_id', selectedPatient.patient.id);
      formData.append('doctor_notes', '');
      formData.append('medicines', JSON.stringify(cleanedMedicines));
      formData.append('consultation_fee', '400');
      formData.append('chief_complaints', JSON.stringify(complaints));
      formData.append('vitals', JSON.stringify(vitals));
      formData.append('clinical_findings', JSON.stringify(clinicalFindings));
      formData.append('diagnosis', diagnosis);
      formData.append('prescription_date', prescriptionDate);
      if (attachedImage) formData.append('prescription_image', attachedImage);
      response = await fetch(`${apiBase}/prescriptions`, { method: 'POST', body: formData });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      alert(errorData.detail || 'Failed to save prescription.');
      return;
    }

    await refreshFrequentPatients();
    await handleSelectPatient(selectedPatient.patient.id, 'previous_visits');
  };

  const loadPreviousVisit = (prescription) => {
    const normalized = normalizePrescription(prescription);
    setEditingPrescriptionId(prescription.id);
    setPrescriptionDate(normalized.prescriptionDate);
    setChiefComplaints(normalized.chiefComplaints);
    setOtherComplaint(normalized.otherComplaint);
    setVitals(normalized.vitals);
    setClinicalFindings(normalized.clinicalFindings);
    setDiagnosis(normalized.diagnosis);
    setMedicationRows(normalized.medicines);
    setAttachedImage(null);
    setActiveTab('prescriptions');
  };

  const renderVisitSummary = (prescription) => {
    const normalized = normalizePrescription(prescription);
    const complaintList = [...normalized.chiefComplaints.filter((item) => item !== 'Others')];
    if (normalized.otherComplaint) complaintList.push(normalized.otherComplaint);

    return (
      <div className="case-sheet-visit-content">
        <div className="case-sheet-grid">
          <div><strong>Name</strong><span>{selectedPatient?.patient.name || '-'}</span></div>
          <div><strong>Date</strong><span>{normalized.prescriptionDate || '-'}</span></div>
          <div><strong>Regn. No.</strong><span>{selectedPatient?.patient.regn_no || selectedPatient?.patient.id || '-'}</span></div>
          <div><strong>Age / Sex</strong><span>{selectedPatient?.patient.age} / {selectedPatient?.patient.gender}</span></div>
          <div><strong>Address</strong><span>{selectedPatient?.patient.address || '-'}</span></div>
          <div><strong>Mobile No.</strong><span>{selectedPatient?.patient.mobile || selectedPatient?.patient.contact || '-'}</span></div>
          <div><strong>Weight</strong><span>{selectedPatient?.patient.weight || '-'}</span></div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <strong>Chief Complaints</strong>
          <div className="case-sheet-note">{complaintList.join(', ') || 'No complaints recorded.'}</div>
        </div>
        <div className="case-sheet-grid" style={{ marginTop: '1rem' }}>
          {Object.keys(defaultVitals).map((key) => (
            <div key={key}><strong>{caseSheetLabel(key)}</strong><span>{normalized.vitals[key] || '-'}</span></div>
          ))}
          <div><strong>Pulse</strong><span>{normalized.clinicalFindings.pulse || '-'}</span></div>
          <div><strong>B.P.</strong><span>{normalized.clinicalFindings.bp || '-'}</span></div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <strong>Diagnosis</strong>
          <div className="case-sheet-note">{normalized.diagnosis || 'No diagnosis recorded.'}</div>
        </div>
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
            </tr>
          </thead>
          <tbody>
            {normalized.medicines.map((row, index) => (
              <tr key={`${prescription.id}-${index}`}>
                <td>{index + 1}</td>
                <td>{row.name || '-'}</td>
                <td>{row.strength || '-'}</td>
                {frequencyKeys.map((key) => <td key={key}>{row.frequency?.[key] ? 'Yes' : '-'}</td>)}
                <td>{row.duration || '-'}</td>
                <td>{row.remarks || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', width: '100%', overflow: 'hidden' }}>
      <aside className="sidebar">
        <div className="sidebar-menu">
          <div onClick={() => selectedPatient && setActiveTab('patients')} className={`sidebar-tab ${activeTab === 'patients' ? 'active' : ''}`} style={{ opacity: selectedPatient ? 1 : 0.45 }}>
            <span>Patient Details</span>
          </div>
          <div onClick={() => selectedPatient && setActiveTab('prescriptions')} className={`sidebar-tab ${activeTab === 'prescriptions' ? 'active' : ''}`} style={{ opacity: selectedPatient ? 1 : 0.45 }}>
            <span>Prescription Workspace</span>
          </div>
          <div onClick={() => selectedPatient && setActiveTab('previous_visits')} className={`sidebar-tab ${activeTab === 'previous_visits' ? 'active' : ''}`} style={{ opacity: selectedPatient ? 1 : 0.45 }}>
            <span>Previous Visits</span>
          </div>
        </div>
        <div className="sidebar-footer">
          <div>System 1 - Doctor PC</div>
          <div style={{ opacity: 0.6 }}>Offline Server Instance</div>
        </div>
      </aside>

      <main className="main-content">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem' }}>
          <div className="search-container" style={{ flex: 1, marginBottom: 0 }}>
            <div className="search-input-wrapper">
              <span className="search-icon">Search</span>
              <input
                type="text"
                className="search-field"
                placeholder="Search by patient ID, name, phone, address, registration date, or visit date"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            {searchResults.length > 0 && (
              <div className="autocomplete-popup">
                {searchResults.map((patient) => (
                  <div key={patient.id} className="autocomplete-item" onClick={() => handleSelectPatient(patient.id)}>
                    <div>
                      <div><span className="autocomplete-name">{patient.name}</span><span style={{ marginLeft: '0.5rem', color: '#667085', fontSize: '0.82rem' }}>{patient.age}y / {patient.gender}</span></div>
                      <div style={{ fontSize: '0.82rem', color: '#667085' }}>
                        {patient.mobile || patient.contact || '-'} | Reg: {patient.registration_date || '-'} | Visit: {patient.latest_visit_date || '-'}
                      </div>
                    </div>
                    <span className="autocomplete-id">{patient.regn_no || patient.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>New Patient</button>
        </div>

        {!selectedPatient ? (
          <div>
            <div style={{ background: 'linear-gradient(135deg, #101b42 0%, #1e295d 100%)', color: 'white', padding: '2.5rem', borderRadius: '16px', boxShadow: 'var(--shadow-md)', marginBottom: '2rem' }}>
              <h2 style={{ color: 'white', marginBottom: '0.5rem' }}>Doctor workspace</h2>
              <p style={{ opacity: 0.85 }}>Search an existing patient or register a new one to start the digital case-sheet flow.</p>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Frequent / Chronic Patients</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                {frequentPatients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => handleSelectPatient(patient.id)}
                    style={{ textAlign: 'left', border: '1px solid #eaecf0', borderRadius: '12px', background: 'white', padding: '1rem', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <strong>{patient.name}</strong>
                      <span className="autocomplete-id">{patient.id}</span>
                    </div>
                    <div style={{ color: '#667085', fontSize: '0.9rem' }}>{patient.age} yrs | {patient.gender}</div>
                    <div style={{ color: '#667085', fontSize: '0.9rem' }}>{patient.contact}</div>
                    <div style={{ marginTop: '0.75rem', color: '#d9383a', fontWeight: 600 }}>Visits: {patient.visit_count}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="info-banner">
              <div className="info-grid">
                <div><div className="info-label">Name</div><div className="info-value">{selectedPatient.patient.name}</div></div>
                <div><div className="info-label">Regn. No.</div><div className="info-value" style={{ fontFamily: 'monospace' }}>{selectedPatient.patient.regn_no || selectedPatient.patient.id}</div></div>
                <div><div className="info-label">Age / Sex</div><div className="info-value">{selectedPatient.patient.age} / {selectedPatient.patient.gender}</div></div>
                <div><div className="info-label">Mobile</div><div className="info-value">{selectedPatient.patient.mobile || selectedPatient.patient.contact}</div></div>
              </div>
            </div>

            {activeTab === 'patients' && (
              <div className="card">
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <div style={{ width: '220px' }}>
                    <div style={{ width: '100%', height: '220px', borderRadius: '12px', overflow: 'hidden', background: '#f2f4f7', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #eaecf0' }}>
                      {selectedPatient.patient.photo_path ? (
                        <img src={`http://${host}:5000${selectedPatient.patient.photo_path}`} alt="Patient" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: '#98a2b3' }}>No photo</span>
                      )}
                    </div>
                    <label className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%', cursor: 'pointer' }}>
                      Upload Scan / File
                      <input type="file" style={{ display: 'none' }} accept="image/*,.pdf" onChange={handleDocumentUpload} />
                    </label>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="case-sheet-grid">
                      <div><strong>DOB</strong><span>{selectedPatient.patient.dob || '-'}</span></div>
                      <div><strong>Age</strong><span>{selectedPatient.patient.age || calculateAge(selectedPatient.patient.dob) || '-'}</span></div>
                      <div><strong>Sex</strong><span>{selectedPatient.patient.gender}</span></div>
                      <div><strong>Address</strong><span>{selectedPatient.patient.address || '-'}</span></div>
                      <div><strong>Mobile No.</strong><span>{selectedPatient.patient.mobile || selectedPatient.patient.contact || '-'}</span></div>
                      <div><strong>Weight</strong><span>{selectedPatient.patient.weight || '-'}</span></div>
                      <div><strong>Regn. No.</strong><span>{selectedPatient.patient.regn_no || selectedPatient.patient.id}</span></div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                      <strong>Medical History</strong>
                      <div className="case-sheet-note">{selectedPatient.patient.medical_history || 'No medical history recorded.'}</div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                      <strong>Uploaded Files</strong>
                      <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {documents.length === 0 ? (
                          <div style={{ color: '#667085' }}>No uploads yet.</div>
                        ) : documents.map((doc, index) => (
                          <div key={`${doc}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eaecf0', borderRadius: '8px', padding: '0.65rem 0.8rem' }}>
                            <span>File {index + 1}</span>
                            <a className="btn btn-secondary" href={`http://${host}:5000${doc}`} target="_blank" rel="noreferrer">View</a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'prescriptions' && (
              <div className="card">
                <h3 style={{ marginBottom: '1rem' }}>{editingPrescriptionId ? 'Edit Previous Visit' : 'Prescription Workspace'}</h3>
                <div className="case-sheet-grid">
                  <div><strong>Name</strong><span>{selectedPatient.patient.name}</span></div>
                  <div>
                    <strong>Date</strong>
                    <input type="date" className="form-input" value={prescriptionDate} onChange={(event) => setPrescriptionDate(event.target.value)} />
                  </div>
                  <div><strong>Regn. No.</strong><span>{selectedPatient.patient.regn_no || selectedPatient.patient.id}</span></div>
                  <div><strong>Age / Sex</strong><span>{selectedPatient.patient.age} / {selectedPatient.patient.gender}</span></div>
                  <div><strong>Address</strong><span>{selectedPatient.patient.address || '-'}</span></div>
                  <div><strong>Mobile No.</strong><span>{selectedPatient.patient.mobile || selectedPatient.patient.contact || '-'}</span></div>
                  <div>
                    <strong>Weight</strong>
                    <input className="form-input" value={selectedPatient.patient.weight || ''} onChange={(event) => updatePatientWeight(event.target.value)} placeholder="Weight for this visit" />
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Vitals</h4>
                  <div className="case-sheet-grid">
                    {Object.keys(defaultVitals).map((key) => (
                      <div key={key}>
                        <strong>{caseSheetLabel(key)}</strong>
                        <input className="form-input" value={vitals[key] || ''} onChange={(event) => setVitals({ ...vitals, [key]: event.target.value })} />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Chief Complaints</h4>
                  <select multiple className="form-input" style={{ minHeight: '180px' }} value={chiefComplaints} onChange={handleComplaintChange}>
                    {complaintOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {chiefComplaints.includes('Others') && (
                    <textarea
                      className="form-input"
                      rows="2"
                      style={{ marginTop: '0.75rem' }}
                      placeholder="Enter other complaint(s), separated by commas"
                      value={otherComplaint}
                      onChange={(event) => setOtherComplaint(event.target.value)}
                    />
                  )}
                </div>

                <div className="case-sheet-grid" style={{ marginTop: '1.5rem' }}>
                  <div>
                    <strong>Clinical Findings</strong>
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input className="form-input" placeholder="Pulse (/per min)" value={clinicalFindings.pulse} onChange={(event) => setClinicalFindings({ ...clinicalFindings, pulse: event.target.value })} />
                      <input className="form-input" placeholder="B.P. (mmHG)" value={clinicalFindings.bp} onChange={(event) => setClinicalFindings({ ...clinicalFindings, bp: event.target.value })} />
                    </div>
                  </div>
                  <div>
                    <strong>Diagnosis</strong>
                    <textarea className="form-input" rows="4" value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4>Rx Table</h4>
                    <button className="btn btn-secondary" type="button" onClick={() => setMedicationRows((rows) => [...rows, createMedicineRow()])}>Add Row</button>
                  </div>
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
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {medicationRows.map((row, index) => (
                        <tr key={`medicine-row-${index}`}>
                          <td>{index + 1}</td>
                          <td>
                            <select className="form-input" value={row.name} onChange={(event) => handleMedicineChange(index, 'name', event.target.value)}>
                              <option value="">Select medicine</option>
                              {inventory.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                            </select>
                          </td>
                          <td><input className="form-input" value={row.strength} onChange={(event) => handleMedicineChange(index, 'strength', event.target.value)} /></td>
                          {frequencyKeys.map((key) => (
                            <td key={key}>
                              <input type="checkbox" checked={Boolean(row.frequency?.[key])} onChange={() => handleFrequencyChange(index, key)} />
                            </td>
                          ))}
                          <td><input className="form-input" value={row.duration} onChange={(event) => handleMedicineChange(index, 'duration', event.target.value)} /></td>
                          <td><input className="form-input" value={row.remarks} onChange={(event) => handleMedicineChange(index, 'remarks', event.target.value)} /></td>
                          <td><button className="btn btn-danger" type="button" onClick={() => setMedicationRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                    Attach Lab / Scan
                    <input type="file" style={{ display: 'none' }} accept="image/*,.pdf" onChange={(event) => setAttachedImage(event.target.files?.[0] || null)} />
                  </label>
                  <button className="btn btn-primary" type="button" onClick={submitPrescription}>
                    {editingPrescriptionId ? 'Update Previous Visit' : 'Finalize and Send'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'previous_visits' && (
              <div className="card">
                <h3 style={{ marginBottom: '1rem' }}>Previous Visits</h3>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {selectedPatient.visits.map((visit) => {
                    const prescription = selectedPatient.prescriptions.find((item) => item.visit_id === visit.id);
                    return (
                      <div key={visit.id} style={{ border: '1px solid #eaecf0', borderRadius: '12px', padding: '1rem', background: '#fcfcfd' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                          <div>
                            <strong>Visit #{visit.visit_number}</strong>
                            <div style={{ color: '#667085', fontSize: '0.9rem' }}>{visit.date}</div>
                          </div>
                          {prescription && <button className="btn btn-secondary" type="button" onClick={() => loadPreviousVisit(prescription)}>Edit This Visit</button>}
                        </div>
                        <div style={{ marginTop: '0.75rem', color: '#344054' }}>
                          <strong>Doctor Notes:</strong> {visit.doctor_notes || 'None'}
                        </div>
                        <div style={{ marginTop: '1rem' }}>
                          {prescription ? renderVisitSummary(prescription) : <div style={{ color: '#667085' }}>No prescription data stored for this visit.</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {showRegisterModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginBottom: '1rem' }}>Register New Patient</h3>
            <form onSubmit={handleRegisterPatient}>
              <div className="form-group">
                <label>Name</label>
                <input className="form-input" required value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>DOB</label>
                  <input className="form-input" type="date" required value={newPatient.dob} onChange={(event) => setNewPatient({ ...newPatient, dob: event.target.value })} />
                </div>
                <div className="form-group">
                  <label>Age</label>
                  <input className="form-input" readOnly value={calculateAge(newPatient.dob)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sex</label>
                  <select className="form-input" value={newPatient.gender} onChange={(event) => setNewPatient({ ...newPatient, gender: event.target.value })}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Weight</label>
                  <input className="form-input" value={newPatient.weight} onChange={(event) => setNewPatient({ ...newPatient, weight: event.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <input className="form-input" value={newPatient.address} onChange={(event) => setNewPatient({ ...newPatient, address: event.target.value })} />
              </div>
              <div className="form-group">
                <label>Mobile No.</label>
                <input className="form-input" required value={newPatient.mobile} onChange={(event) => setNewPatient({ ...newPatient, mobile: event.target.value })} />
              </div>
              <div className="form-group">
                <label>Regn. No.</label>
                <input className="form-input" readOnly value="Auto-generated on save" />
              </div>
              <div className="form-group">
                <label>Medical History</label>
                <textarea className="form-input" rows="3" value={newPatient.medical_history} onChange={(event) => setNewPatient({ ...newPatient, medical_history: event.target.value })} />
              </div>
              <div className="form-group">
                <label>Patient Photo / ID</label>
                {photoPreview && <img src={photoPreview} alt="Preview" style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '8px', display: 'block', marginBottom: '0.75rem' }} />}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setNewPatient({ ...newPatient, photo: file });
                    setPhotoPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button className="btn btn-secondary" type="button" onClick={() => setShowRegisterModal(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit">Register and Open</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
