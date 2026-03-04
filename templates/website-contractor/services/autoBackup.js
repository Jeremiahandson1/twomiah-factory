const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dataDir = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../persistent/data')
  : path.join(__dirname, '../data');
const uploadsDir = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../persistent/uploads')
  : path.join(__dirname, '../../frontend/public/uploads');
const backupsDir = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../persistent/backups')
  : path.join(__dirname, '../backups');

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const MAX_BACKUPS = 3;                        // Keep last 3 backups
const MIN_HOURS_BETWEEN_BACKUPS = 23;         // Don't backup more than once per day
const BACKUP_CHECK_INTERVAL = 6 * 60 * 60 * 1000;  // Check every 6 hours (not 24h — handles restarts gracefully)
const MIN_DISK_MB = 50;                       // Don't backup if less than 50MB free

function ensureBackupsDir() {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
}

// Check if enough time has passed since last backup
function shouldBackup() {
  ensureBackupsDir();
  const backups = getBackupFiles();
  
  if (backups.length === 0) return true;
  
  // Parse timestamp from most recent backup filename
  const latest = backups[0]; // sorted newest first
  const stats = fs.statSync(path.join(backupsDir, latest));
  const hoursSince = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
  
  if (hoursSince < MIN_HOURS_BETWEEN_BACKUPS) {
    console.log(`[Backup] Skipping — last backup was ${hoursSince.toFixed(1)}h ago (min: ${MIN_HOURS_BETWEEN_BACKUPS}h)`);
    return false;
  }
  
  return true;
}

// Check available disk space
function hasEnoughDisk() {
  try {
    const output = execSync('df -m /opt/render 2>/dev/null || df -m / 2>/dev/null', { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availMB = parseInt(parts[3], 10);
      if (availMB < MIN_DISK_MB) {
        console.log(`[Backup] Skipping — only ${availMB}MB free (need ${MIN_DISK_MB}MB)`);
        return false;
      }
    }
  } catch (err) {
    // Can't check disk — proceed anyway
  }
  return true;
}

function getBackupFiles() {
  ensureBackupsDir();
  return fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse();
}

function pruneOldBackups() {
  const backups = getBackupFiles();
  const toDelete = backups.slice(MAX_BACKUPS);
  toDelete.forEach(old => {
    try {
      fs.unlinkSync(path.join(backupsDir, old));
      console.log(`[Backup] Pruned: ${old}`);
    } catch (err) {
      console.error(`[Backup] Failed to prune ${old}:`, err.message);
    }
  });
  return toDelete.length;
}

function createBackup(force = false) {
  // Always prune first to free space
  pruneOldBackups();

  if (!force && !shouldBackup()) {
    return { success: true, skipped: true, reason: 'Too recent' };
  }
  
  if (!hasEnoughDisk()) {
    return { success: false, error: 'Insufficient disk space' };
  }

  ensureBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${timestamp}.tar.gz`;
  const filepath = path.join(backupsDir, filename);

  try {
    const dirs = [];
    if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
      dirs.push(`-C "${path.dirname(dataDir)}" "${path.basename(dataDir)}"`);
    }
    if (fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0) {
      dirs.push(`-C "${path.dirname(uploadsDir)}" "${path.basename(uploadsDir)}"`);
    }

    if (dirs.length === 0) {
      console.log('[Backup] Nothing to back up — no data or uploads found');
      return { success: true, skipped: true, reason: 'No data' };
    }

    execSync(`tar -czf "${filepath}" ${dirs.join(' ')}`, { timeout: 120000 });
    
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Backup] Created: ${filename} (${sizeMB}MB)`);

    // Prune again after creating
    pruneOldBackups();

    return { success: true, filename, path: filepath, size: stats.size };
  } catch (err) {
    console.error('[Backup] Failed:', err.message);
    // Clean up failed backup file
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (e) {}
    return { success: false, error: err.message };
  }
}

function listBackups() {
  return getBackupFiles().map(f => {
    const stats = fs.statSync(path.join(backupsDir, f));
    return {
      filename: f,
      size: stats.size,
      sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      created: stats.mtime.toISOString()
    };
  });
}

function startSchedule() {
  // Check after 60s (let server settle), then every 6 hours
  // shouldBackup() prevents more than one per day
  setTimeout(() => {
    console.log('[Backup] Checking if backup needed...');
    createBackup();
  }, 60000);

  setInterval(() => {
    console.log('[Backup] Scheduled check...');
    createBackup();
  }, BACKUP_CHECK_INTERVAL);

  console.log(`[Backup] Scheduled: checks every 6h, max 1/day, keeping last ${MAX_BACKUPS}`);
}

module.exports = { createBackup, listBackups, startSchedule, backupsDir, pruneOldBackups };
