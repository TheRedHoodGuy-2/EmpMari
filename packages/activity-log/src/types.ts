export interface ActivityLogEntry {
  groupId:   string;
  messageId: string | null;
}

export interface ActivityScore {
  groupId:       string;
  messageCount:  number;   // raw count in past hour
  score:         number;   // 0.0 to 1.0
  windowMinutes: number;   // always 60
}
