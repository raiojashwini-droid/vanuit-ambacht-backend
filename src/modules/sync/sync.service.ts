export type SyncEntity =
  | 'leads'
  | 'quotes'
  | 'projects'
  | 'invoices'
  | 'settings'
  | 'customers'
  | 'partners';

export interface SyncStatusDto {
  version: number;
  timestamp: string;
  entities: Record<SyncEntity, number>;
}

class SyncService {
  private version = 1;
  private entityTimestamps: Record<SyncEntity, number> = {
    leads: Date.now(),
    quotes: Date.now(),
    projects: Date.now(),
    invoices: Date.now(),
    settings: Date.now(),
    customers: Date.now(),
    partners: Date.now(),
  };

  /**
   * Bump entity mutation timestamp and overall system sync version
   */
  bump(entity: SyncEntity): void {
    this.version += 1;
    this.entityTimestamps[entity] = Date.now();
  }

  /**
   * Return current sync version and per-entity last mutation timestamps
   */
  getStatus(): SyncStatusDto {
    return {
      version: this.version,
      timestamp: new Date().toISOString(),
      entities: { ...this.entityTimestamps },
    };
  }
}

export const syncService = new SyncService();
