// ============================================================
// @mariabelle/imager — Types
// ============================================================

export interface CardImageInput {
  spawnId:     string;
  groupId:     string;
  senderJid:   string;
  rawCaption:  string;
  imageBuffer: Buffer;
  detectedAt:  Date;
}

export interface StoredCardImage {
  id:          string;
  spawnId:     string;
  groupId:     string;
  senderJid:   string;
  rawCaption:  string;
  storagePath: string;
  publicUrl:   string;
  detectedAt:  string;
  designTag:   string | null;
  createdAt:   string;
}
