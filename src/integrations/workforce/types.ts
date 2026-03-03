export type SyncEmployeeRequest = {
  keycloakId: string;
  email?: string;
  username?: string;
  ip?: string;
};

export type EmployeeDto = {
  id: string;
  keycloakId: string;
  email?: string;
  username?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PresenceStatus =
  | 'online'
  | 'offline'
  | 'away'
  | 'busy'
  | 'unknown'
  | string;

export type ShiftDto = {
  id: string;
  employeeId: string;
  startedAt: string;
  stoppedAt?: string;
  status?: string;
};

export type PresenceHistoryItem = {
  status: PresenceStatus;
  changedAt: string; // ISO timestamp
};
