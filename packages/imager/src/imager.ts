// ============================================================
// @mariabelle/imager — Image store + retrieval
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CardImageInput, StoredCardImage } from './types.js';

const BUCKET = 'card-images';

export function createImager(supabase: SupabaseClient) {
  return {
    async store(input: CardImageInput): Promise<StoredCardImage | null> {
      console.log('[IMAGER] Starting store for spawnId:', input.spawnId);
      console.log('[IMAGER] Buffer size:', input.imageBuffer?.length ?? 'null');
      console.log('[IMAGER] Supabase URL set:', !!process.env['SUPABASE_URL']);
      const storagePath = `cards/${input.spawnId}.jpg`;

      // 1. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, input.imageBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.error('[IMAGER] Upload failed:', uploadError.message);
        return null;
      }

      // 2. Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      const publicUrl = urlData.publicUrl;

      // 3. Insert into card_images table
      const { data, error: insertError } = await supabase
        .from('card_images')
        .insert({
          spawn_id:     input.spawnId,
          group_id:     input.groupId,
          sender_jid:   input.senderJid,
          raw_caption:  input.rawCaption,
          storage_path: storagePath,
          public_url:   publicUrl,
          detected_at:  input.detectedAt.toISOString(),
          design_tag:   null,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[IMAGER] DB insert failed:', insertError.message);
        return null;
      }

      console.log(`[IMAGER] Stored ${input.spawnId} → ${publicUrl}`);

      const row = data as Record<string, unknown>;
      return {
        id:          row['id'] as string,
        spawnId:     row['spawn_id'] as string,
        groupId:     row['group_id'] as string,
        senderJid:   row['sender_jid'] as string,
        rawCaption:  row['raw_caption'] as string,
        storagePath: row['storage_path'] as string,
        publicUrl:   row['public_url'] as string,
        detectedAt:  row['detected_at'] as string,
        designTag:   row['design_tag'] as string | null,
        createdAt:   row['created_at'] as string,
      };
    },

    async getBySpawnId(spawnId: string): Promise<StoredCardImage | null> {
      const { data, error } = await supabase
        .from('card_images')
        .select('*')
        .eq('spawn_id', spawnId)
        .single();

      if (error) {
        console.error('[IMAGER] getBySpawnId failed:', error.message);
        return null;
      }

      const row = data as Record<string, unknown>;
      return {
        id:          row['id'] as string,
        spawnId:     row['spawn_id'] as string,
        groupId:     row['group_id'] as string,
        senderJid:   row['sender_jid'] as string,
        rawCaption:  row['raw_caption'] as string,
        storagePath: row['storage_path'] as string,
        publicUrl:   row['public_url'] as string,
        detectedAt:  row['detected_at'] as string,
        designTag:   row['design_tag'] as string | null,
        createdAt:   row['created_at'] as string,
      };
    },

    async tagDesign(spawnId: string, designTag: string): Promise<void> {
      const { error } = await supabase
        .from('card_images')
        .update({ design_tag: designTag })
        .eq('spawn_id', spawnId);

      if (error) {
        console.error('[IMAGER] tagDesign failed:', error.message);
      }
    },
  };
}

export type Imager = ReturnType<typeof createImager>;
