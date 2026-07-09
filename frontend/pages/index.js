import React, { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [qbConnected, setQbConnected] = useState(false);
  const [sheetsConnected, setSheetsConnected] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  
  const [bulkSyncLoading, setBulkSyncLoading] = useState(false);
  const [overdueScanLoading, setOverdueScanLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Simulated live activity logs
  const [logs, setLogs] = useState([
    { id: 1, time: '10:42 AM', type: 'invoice.created', text: 'Invoice #1042 created in QuickBooks → Appended to Sheets', status: 'pending' },
    { id: 2, time: '11:15 AM', type: 'payment.received', text: 'Payment received for #1042 → Updated Sheets (Green) → Gmail Sent', status: 'success' },
    { id: 3, time: '09:00 AM', type: 'cron.overdue', text: 'Cron: Invoice #1038 overdue → Updated Sheets (Red) → Gmail Reminder Sent', status: 'overdue' },
  ]);

  const handleBulkSync = async () => {
    setBulkSyncLoading(true);
    setNotification(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
    try {
      const res = await fetch(`${apiUrl}/api/sync/bulk`);
      const data = await res.json();
      if (data.success) {
        setNotification({
          type: 'success',
          message: `Bulk Sync Successful! Processed ${data.count} invoices and updated Google Sheets.`
        });
        // Add a log entry dynamically
        setLogs(prev => [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'sync.bulk',
            text: `Manual Bulk Sync: Synced ${data.count} invoices from QBO to Google Sheets.`,
            status: 'success'
          },
          ...prev
        ]);
      } else {
        throw new Error(data.error || data.details || 'Sync failed');
      }
    } catch (err) {
      console.error('Error during bulk sync:', err);
      setNotification({
        type: 'error',
        message: `Bulk Sync Failed: ${err.message}`
      });
    } finally {
      setBulkSyncLoading(false);
    }
  };

  const handleOverdueScan = async () => {
    setOverdueScanLoading(true);
    setNotification(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
    try {
      const res = await fetch(`${apiUrl}/api/test/scan-overdue`);
      const data = await res.json();
      if (data.success) {
        setNotification({
          type: 'success',
          message: `Overdue Scan Completed! Checked and updated ${data.processedCount} past-due invoices.`
        });
        // Add log entry dynamically
        setLogs(prev => [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'cron.overdue',
            text: `Manual Scan: Identified ${data.processedCount} overdue invoices, sent emails and updated Sheets.`,
            status: 'overdue'
          },
          ...prev
        ]);
      } else {
        throw new Error(data.error || data.details || 'Scan failed');
      }
    } catch (err) {
      console.error('Error during overdue scan:', err);
      setNotification({
        type: 'error',
        message: `Overdue Scan Failed: ${err.message}`
      });
    } finally {
      setOverdueScanLoading(false);
    }
  };

  useEffect(() => {
    // 1. Check if redirecting from a successful QuickBooks authentication flow
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('qb_connected') === 'true') {
      setQbConnected(true);
      // Clean url parameters silently without refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      // 2. Query Express backend for QuickBooks token connection existence
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
      fetch(`${apiUrl}/api/auth/quickbooks/status`)
        .then((res) => res.json())
        .then((data) => {
          if (data.connected) {
            setQbConnected(true);
          }
        })
        .catch((err) => console.error('Error fetching QuickBooks connection status:', err));
    }
  }, []);

  const handleConnectQB = () => {
    // Week 1 redirect logic: calls the Express backend's QuickBooks auth authorization URL generator
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
    window.location.href = `${apiUrl}/api/auth/quickbooks`;
  };

  const handleConnectSheets = () => {
    setSheetsConnected(true);
  };

  const handleConnectGmail = () => {
    setGmailConnected(true);
  };

  return (
    <div style={styles.container}>
      <Head>
        <title>SME Invoice Sync — Enterprise Automation for Small Business</title>
        <meta name="description" content="Connect QuickBooks, Google Sheets, and Gmail in 10 minutes. Eliminate manual data entry." />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Background Gradient Orbs */}
      <div style={styles.orb1} />
      <div style={styles.orb2} />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoContainer}>
          <div style={styles.logoIcon}>⚡</div>
          <span style={styles.logoText}>SME<span style={styles.logoSubText}>InvoiceSync</span></span>
        </div>
        <div style={styles.statusIndicator}>
          <span style={styles.statusDot} />
          <span style={styles.statusText}>Systems Operational</span>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Welcome Section */}
        <section style={styles.heroSection}>
          <h1 style={styles.title}>Never manually sync an invoice again.</h1>
          <p style={styles.subtitle}>
            Your automated bridge between <strong style={{ color: '#2ecc71' }}>QuickBooks</strong>, <strong style={{ color: '#3498db' }}>Google Sheets</strong>, and <strong style={{ color: '#e74c3c' }}>Gmail</strong>. Setup in under 10 minutes.
          </p>
        </section>

        {/* Grid Setup */}
        <div style={styles.dashboardGrid}>
          {/* Card 1: Onboarding Connections */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>1. Integration Setup</h2>
            <p style={styles.cardDesc}>Complete these connections to start syncing automatically.</p>

            <div style={styles.stepList}>
              {/* Step 1: QuickBooks */}
              <div style={{
                ...styles.stepRow,
                border: qbConnected ? '1px solid rgba(46, 204, 113, 0.2)' : '1px solid rgba(255, 255, 255, 0.03)',
                backgroundColor: qbConnected ? 'rgba(46, 204, 113, 0.01)' : 'rgba(255, 255, 255, 0.015)'
              }}>
                <div style={{
                  ...styles.stepNumActive,
                  backgroundColor: qbConnected ? '#2ecc71' : '#9b59b6',
                  boxShadow: qbConnected ? '0 0 12px rgba(46, 204, 113, 0.3)' : '0 0 12px rgba(155, 89, 182, 0.4)'
                }}>
                  {qbConnected ? '✓' : '1'}
                </div>
                <div style={styles.stepInfo}>
                  <h3 style={styles.stepTitle}>Connect QuickBooks</h3>
                  <p style={styles.stepDesc}>OAuth securely with your QuickBooks sandbox/live company.</p>
                </div>
                <button 
                  onClick={qbConnected ? null : handleConnectQB} 
                  disabled={qbConnected}
                  style={{
                    ...styles.connectButton,
                    ...(qbConnected ? {
                      backgroundColor: 'rgba(46, 204, 113, 0.12)',
                      color: '#2ecc71',
                      border: '1px solid rgba(46, 204, 113, 0.25)',
                      cursor: 'default',
                      boxShadow: 'none'
                    } : styles.qbButton)
                  }}
                >
                  {qbConnected ? 'Connected' : 'Connect QB'}
                </button>
              </div>

              {/* Step 2: Google Sheets */}
              <div style={{ 
                ...styles.stepRow, 
                opacity: qbConnected ? 1 : 0.5,
                border: sheetsConnected ? '1px solid rgba(52, 152, 219, 0.2)' : '1px solid rgba(255, 255, 255, 0.03)',
                backgroundColor: sheetsConnected ? 'rgba(52, 152, 219, 0.01)' : 'rgba(255, 255, 255, 0.015)'
              }}>
                <div style={{
                  ...(qbConnected ? styles.stepNumActive : styles.stepNum),
                  backgroundColor: sheetsConnected ? '#3498db' : (qbConnected ? '#9b59b6' : 'rgba(255, 255, 255, 0.05)'),
                  boxShadow: sheetsConnected ? '0 0 12px rgba(52, 152, 219, 0.3)' : (qbConnected ? '0 0 12px rgba(155, 89, 182, 0.4)' : 'none'),
                  color: (qbConnected || sheetsConnected) ? '#ffffff' : '#7f8c8d'
                }}>
                  {sheetsConnected ? '✓' : '2'}
                </div>
                <div style={styles.stepInfo}>
                  <h3 style={styles.stepTitle}>Connect Google Sheets</h3>
                  <p style={styles.stepDesc}>Automatically push QuickBooks invoice updates to Sheets.</p>
                </div>
                <button 
                  onClick={handleConnectSheets}
                  disabled={!qbConnected || sheetsConnected} 
                  style={{
                    ...styles.connectButton,
                    ...(!qbConnected ? styles.disabledButton : (sheetsConnected ? {
                      backgroundColor: 'rgba(52, 152, 219, 0.12)',
                      color: '#3498db',
                      border: '1px solid rgba(52, 152, 219, 0.25)',
                      cursor: 'default',
                      boxShadow: 'none'
                    } : {
                      backgroundColor: '#3498db',
                      color: '#ffffff',
                      boxShadow: '0 4px 14px rgba(52, 152, 219, 0.25)'
                    }))
                  }}
                >
                  {sheetsConnected ? 'Connected' : 'Connect Sheets'}
                </button>
              </div>

              {/* Step 3: Gmail */}
              <div style={{ 
                ...styles.stepRow, 
                opacity: sheetsConnected ? 1 : 0.5,
                border: gmailConnected ? '1px solid rgba(231, 76, 60, 0.2)' : '1px solid rgba(255, 255, 255, 0.03)',
                backgroundColor: gmailConnected ? 'rgba(231, 76, 60, 0.01)' : 'rgba(255, 255, 255, 0.015)'
              }}>
                <div style={{
                  ...(sheetsConnected ? styles.stepNumActive : styles.stepNum),
                  backgroundColor: gmailConnected ? '#e74c3c' : (sheetsConnected ? '#9b59b6' : 'rgba(255, 255, 255, 0.05)'),
                  boxShadow: gmailConnected ? '0 0 12px rgba(231, 76, 60, 0.3)' : (sheetsConnected ? '0 0 12px rgba(155, 89, 182, 0.4)' : 'none'),
                  color: (sheetsConnected || gmailConnected) ? '#ffffff' : '#7f8c8d'
                }}>
                  {gmailConnected ? '✓' : '3'}
                </div>
                <div style={styles.stepInfo}>
                  <h3 style={styles.stepTitle}>Connect Gmail</h3>
                  <p style={styles.stepDesc}>Configure auto customer receipts & overdue payment alerts.</p>
                </div>
                <button 
                  onClick={handleConnectGmail}
                  disabled={!sheetsConnected || gmailConnected} 
                  style={{
                    ...styles.connectButton,
                    ...(!sheetsConnected ? styles.disabledButton : (gmailConnected ? {
                      backgroundColor: 'rgba(231, 76, 60, 0.12)',
                      color: '#e74c3c',
                      border: '1px solid rgba(231, 76, 60, 0.25)',
                      cursor: 'default',
                      boxShadow: 'none'
                    } : {
                      backgroundColor: '#e74c3c',
                      color: '#ffffff',
                      boxShadow: '0 4px 14px rgba(231, 76, 60, 0.25)'
                    }))
                  }}
                >
                  {gmailConnected ? 'Connected' : 'Connect Gmail'}
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Live Activity Feed */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>2. Live Automation Logs</h2>
            <p style={styles.cardDesc}>Simulated activity feed showing active invoice, payment, and cron checks.</p>

            <div style={styles.logContainer}>
              {logs.map((log) => (
                <div key={log.id} style={styles.logRow}>
                  <div style={styles.logMeta}>
                    <span style={styles.logTime}>{log.time}</span>
                    <span style={{
                      ...styles.logBadge,
                      backgroundColor: log.status === 'success' ? 'rgba(46, 204, 113, 0.15)' : 
                                       log.status === 'overdue' ? 'rgba(231, 76, 60, 0.15)' : 'rgba(241, 196, 15, 0.15)',
                      color: log.status === 'success' ? '#2ecc71' : 
                             log.status === 'overdue' ? '#e74c3c' : '#f1c40f'
                    }}>
                      {log.type}
                    </span>
                  </div>
                  <p style={styles.logText}>{log.text}</p>
                </div>
              ))}
            </div>

            {/* Performance Stats Overlay */}
            <div style={styles.statsContainer}>
              <div style={styles.statBox}>
                <span style={styles.statVal}>4.8 Hrs</span>
                <span style={styles.statLabel}>Saved This Week</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statVal}>$240</span>
                <span style={styles.statLabel}>Value Generated</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statVal}>100%</span>
                <span style={styles.statLabel}>Accuracy Rate</span>
              </div>
            </div>
          </div>
        </div>

        {/* Manual Operations Control Panel */}
        <section style={styles.controlsSection}>
          <div style={styles.controlsCard}>
            <h2 style={styles.cardTitle}>⚙️ Admin Control Panel</h2>
            <p style={styles.cardDesc}>Manually trigger integration sync pipelines and diagnostic routines.</p>
            
            <div style={styles.controlsGrid}>
              {/* Action 1: Bulk Sync */}
              <div style={styles.controlBox}>
                <div style={styles.controlInfo}>
                  <h3 style={styles.controlTitle}>Bulk Sync All Invoices</h3>
                  <p style={styles.controlDesc}>
                    Fetches all past and present invoices from QuickBooks Online and synchronizes them to Google Sheets in bulk.
                  </p>
                </div>
                <div style={styles.controlActions}>
                  <button 
                    onClick={handleBulkSync}
                    disabled={bulkSyncLoading || !qbConnected}
                    style={{
                      ...styles.actionButton,
                      backgroundColor: '#3498db',
                      color: '#ffffff',
                      boxShadow: '0 4px 14px rgba(52, 152, 219, 0.25)',
                      opacity: (bulkSyncLoading || !qbConnected) ? 0.6 : 1,
                      cursor: (bulkSyncLoading || !qbConnected) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {bulkSyncLoading ? 'Syncing...' : 'Sync All Invoices'}
                  </button>
                </div>
              </div>

              {/* Action 2: Trigger Overdue Scan */}
              <div style={styles.controlBox}>
                <div style={styles.controlInfo}>
                  <h3 style={styles.controlTitle}>Trigger Overdue Scan</h3>
                  <p style={styles.controlDesc}>
                    Instantly scans QuickBooks for past-due invoices, flags them in Google Sheets (red), and sends reminder emails via Gmail.
                  </p>
                </div>
                <div style={styles.controlActions}>
                  <button 
                    onClick={handleOverdueScan}
                    disabled={overdueScanLoading || !qbConnected}
                    style={{
                      ...styles.actionButton,
                      backgroundColor: '#e74c3c',
                      color: '#ffffff',
                      boxShadow: '0 4px 14px rgba(231, 76, 60, 0.25)',
                      opacity: (overdueScanLoading || !qbConnected) ? 0.6 : 1,
                      cursor: (overdueScanLoading || !qbConnected) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {overdueScanLoading ? 'Scanning...' : 'Trigger Scan'}
                  </button>
                </div>
              </div>
            </div>

            {/* Notification messages */}
            {notification && (
              <div style={{
                ...styles.notificationBanner,
                backgroundColor: notification.type === 'error' ? 'rgba(231, 76, 60, 0.15)' : 'rgba(46, 204, 113, 0.15)',
                border: notification.type === 'error' ? '1px solid rgba(231, 76, 60, 0.25)' : '1px solid rgba(46, 204, 113, 0.25)',
                color: notification.type === 'error' ? '#e74c3c' : '#2ecc71'
              }}>
                <span style={{ marginRight: '8px' }}>{notification.type === 'error' ? '❌' : '✅'}</span>
                <span>{notification.message}</span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

// Styling Object
const styles = {
  container: {
    backgroundColor: '#0a0a0c',
    color: '#f8f9fa',
    minHeight: '100vh',
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '0 2rem 4rem 2rem',
    position: 'relative',
    overflow: 'hidden',
  },
  orb1: {
    position: 'absolute',
    top: '-15%',
    right: '-10%',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(142, 68, 173, 0.15) 0%, rgba(0,0,0,0) 70%)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  orb2: {
    position: 'absolute',
    bottom: '-10%',
    left: '-10%',
    width: '600px',
    height: '600px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(46, 204, 113, 0.08) 0%, rgba(0,0,0,0) 70%)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    position: 'relative',
    zIndex: 10,
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logoIcon: {
    fontSize: '1.5rem',
    background: 'linear-gradient(135deg, #9b59b6, #3498db)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  logoText: {
    fontSize: '1.25rem',
    fontWeight: '700',
    letterSpacing: '-0.5px',
  },
  logoSubText: {
    fontWeight: '400',
    color: '#95a5a6',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'rgba(46, 204, 113, 0.08)',
    padding: '0.4rem 0.8rem',
    borderRadius: '20px',
    border: '1px solid rgba(46, 204, 113, 0.15)',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#2ecc71',
    boxShadow: '0 0 8px #2ecc71',
  },
  statusText: {
    fontSize: '0.8rem',
    color: '#2ecc71',
    fontWeight: '500',
  },
  main: {
    position: 'relative',
    zIndex: 10,
    maxWidth: '1200px',
    margin: '0 auto',
    paddingTop: '3.5rem',
  },
  heroSection: {
    textAlign: 'center',
    marginBottom: '4rem',
  },
  title: {
    fontSize: '2.8rem',
    fontWeight: '800',
    letterSpacing: '-1.5px',
    marginBottom: '1rem',
    background: 'linear-gradient(135deg, #ffffff 0%, #a6b1e1 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '1.2rem',
    color: '#9ea6b3',
    maxWidth: '650px',
    margin: '0 auto',
    lineHeight: '1.6',
  },
  dashboardGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2.5rem',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '16px',
    padding: '2.5rem',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
  },
  cardTitle: {
    fontSize: '1.4rem',
    fontWeight: '600',
    marginBottom: '0.3rem',
  },
  cardDesc: {
    color: '#7f8c8d',
    fontSize: '0.9rem',
    marginBottom: '2rem',
  },
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.2rem',
    padding: '1.2rem',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    transition: 'all 0.3s ease',
  },
  stepNumActive: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#9b59b6',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '1rem',
    fontWeight: '700',
    color: '#ffffff',
    boxShadow: '0 0 12px rgba(155, 89, 182, 0.4)',
  },
  stepNum: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#7f8c8d',
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: '0.95rem',
    fontWeight: '600',
    marginBottom: '0.2rem',
  },
  stepDesc: {
    fontSize: '0.8rem',
    color: '#7f8c8d',
    lineHeight: '1.4',
  },
  connectButton: {
    border: 'none',
    borderRadius: '8px',
    padding: '0.6rem 1.2rem',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  qbButton: {
    backgroundColor: '#2ecc71',
    color: '#0a0a0c',
    boxShadow: '0 4px 14px rgba(46, 204, 113, 0.25)',
  },
  disabledButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#7f8c8d',
    border: 'none',
    borderRadius: '8px',
    padding: '0.6rem 1.2rem',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'not-allowed',
  },
  logContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.2rem',
    flex: 1,
  },
  logRow: {
    padding: '1rem',
    borderRadius: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderLeft: '3px solid rgba(255, 255, 255, 0.1)',
  },
  logMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  logTime: {
    fontSize: '0.75rem',
    color: '#5b626e',
  },
  logBadge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    textTransform: 'uppercase',
  },
  logText: {
    fontSize: '0.85rem',
    color: '#c5c9d0',
    margin: 0,
    lineHeight: '1.4',
  },
  statsContainer: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '1rem',
    marginTop: '2rem',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '1.5rem',
  },
  statBox: {
    textAlign: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '8px',
    padding: '0.8rem 0.5rem',
  },
  statVal: {
    display: 'block',
    fontSize: '1.1rem',
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: '0.1rem',
  },
  statLabel: {
    fontSize: '0.7rem',
    color: '#7f8c8d',
  },
  controlsSection: {
    marginTop: '3rem',
    position: 'relative',
    zIndex: 10,
  },
  controlsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '16px',
    padding: '2.5rem',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
  },
  controlsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2rem',
    marginTop: '1rem',
  },
  controlBox: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '1.5rem',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    gap: '1.5rem',
  },
  controlInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  controlTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    margin: 0,
  },
  controlDesc: {
    fontSize: '0.85rem',
    color: '#7f8c8d',
    lineHeight: '1.5',
    margin: 0,
  },
  controlActions: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  actionButton: {
    border: 'none',
    borderRadius: '8px',
    padding: '0.75rem 1.5rem',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  notificationBanner: {
    marginTop: '2rem',
    padding: '1rem 1.5rem',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    fontSize: '0.9rem',
    fontWeight: '500',
  },
};
