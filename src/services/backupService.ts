import { db } from '../db/storage';
import { User } from '../types';
import { generateUUID } from '../utils/crypto';
import { CloudflareApi } from './cloudflareApi';

export class BackupService {
  /**
   * Export full database as a JSON download file.
   * Restricted to Admin.
   */
  public static exportBackup(currentUser: User): { success: boolean; data?: string; filename?: string; error?: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Permission Denied: Database backups are restricted to Administrators.' };
    }

    const payload = db.exportFullBackup();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `omnibiz_pos_backup_${timestamp}.json`;

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'EXPORT_BACKUP',
      details: `Generated full local database backup file (${filename})`,
      entityType: 'BACKUP',
      timestamp: new Date().toISOString(),
    });

    return { success: true, data: payload, filename };
  }

  public static exportBackupFile(currentUser: User): void {
    const res = BackupService.exportBackup(currentUser);
    if (!res.success || !res.data) return;

    const blob = new Blob([res.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename || `omnibiz_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Upload full database backup to cloud storage.
   * Restricted to Admin.
   */
  public static async uploadBackupToCloud(currentUser: User): Promise<{ success: boolean; message?: string }> {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Permission Denied: Only Admin can upload backups.' };
    }

    if (CloudflareApi.DISCONNECTED_MODE) {
      return { success: false, message: 'External cloud storage is currently disconnected. Please use the Local JSON Backup export below.' };
    }

    const online = await CloudflareApi.checkConnection();
    if (!online) {
      return { success: false, message: 'Offline: Cannot upload backup to cloud.' };
    }

    try {
      const backupData = db.exportFullBackup();
      const blob = new Blob([backupData], { type: 'application/json' });
      
      const result = await CloudflareApi.uploadBackup(blob);
      
      if (result.success) {
        db.addAuditLog({
          id: generateUUID(),
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'UPLOAD_BACKUP_CLOUD',
          details: `Uploaded full database backup to cloud storage (${result.key})`,
          entityType: 'BACKUP',
          timestamp: new Date().toISOString(),
        });
        
        return { success: true, message: `Backup uploaded successfully to cloud (${result.size} bytes)` };
      }
      
      return { success: false, message: 'Failed to upload backup.' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restore database from uploaded JSON string.
   * Restricted to Admin.
   */
  public static restoreBackup(
    jsonString: string,
    currentUser: User
  ): { success: boolean; message: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Permission Denied: Only Admin can restore database backups.' };
    }

    const result = db.importFullBackup(jsonString);

    if (result.success) {
      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'RESTORE_BACKUP',
        details: `Restored database from external archive.`,
        entityType: 'BACKUP',
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  }

  public static restoreFromBackupFile(
    jsonString: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const res = BackupService.restoreBackup(jsonString, currentUser);
    return { success: res.success, error: res.success ? undefined : res.message };
  }

  public static wipeAllData(currentUser: User): { success: boolean; error?: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Permission Denied: Only Admin can clear database data.' };
    }

    db.wipeAllData(true);

    return { success: true };
  }
}
