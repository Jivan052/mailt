// components/StatusBadge.jsx
import styles from './StatusBadge.module.css'

const MAP = {
  'Deliverable':    { cls: 'deliverable', dot: '#15803d' },
  'Risky':          { cls: 'risky',       dot: '#92400e' },
  'SMTP Blocked':   { cls: 'blocked',     dot: '#1d4ed8' },
  'SMTP Failed':    { cls: 'failed',      dot: '#c2410c' },
  'No MX Record':   { cls: 'nomx',        dot: '#b91c1c' },
  'Disposable':     { cls: 'disposable',  dot: '#6d28d9' },
  'Invalid Format': { cls: 'invalid',     dot: '#5c5a53' },
}

export default function StatusBadge({ status }) {
  const { cls, dot } = MAP[status] || { cls: 'invalid', dot: '#5c5a53' }
  return (
    <span className={`${styles.badge} ${styles[cls]}`}>
      <span className={styles.dot} style={{ background: dot }} />
      {status}
    </span>
  )
}
