'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────

type SorterImage = {
  id:         string;
  created_at: string;
  spawn_id:   string;
  public_url: string;
  design_tag: string | null;
  raw_caption: string | null;
};

type DesignTag = 'new design' | 'old design';

// ── Tag button ────────────────────────────────────────────────

const TAG_OPTIONS: { value: DesignTag; label: string; color: string; dim: string }[] = [
  { value: 'new design', label: '✦ New Design', color: 'var(--blue)',  dim: 'var(--blue-dim)'  },
  { value: 'old design', label: '◈ Old Design', color: 'var(--amber)', dim: 'var(--amber-dim)' },
];

// ── Helpers ───────────────────────────────────────────────────

function generateUploadId(): string {
  return 'upload-' + Math.random().toString(36).slice(2, 10);
}

// ── Single card in the sorter grid ───────────────────────────

function SorterCard({
  image,
  onTag,
}: {
  image:  SorterImage;
  onTag:  (id: string, spawnId: string, tag: DesignTag) => Promise<void>;
}) {
  const [saving, setSaving] = useState<DesignTag | null>(null);

  async function handleTag(tag: DesignTag) {
    if (saving) return;
    setSaving(tag);
    await onTag(image.id, image.spawn_id, tag);
    setSaving(null);
  }

  const currentTag = image.design_tag as DesignTag | null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Image — full, no clipping */}
      <div style={{ background: 'var(--surface2)', position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.public_url}
          alt={image.spawn_id}
          loading="lazy"
          style={{ width: '100%', display: 'block' }}
        />

        {/* Current tag overlay — top right */}
        {currentTag && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
            background: currentTag === 'new design' ? 'var(--blue)' : 'var(--amber)',
            color: '#fff',
            backdropFilter: 'blur(4px)',
          }}>
            {currentTag === 'new design' ? '✦ New' : '◈ Old'}
          </span>
        )}
      </div>

      {/* Spawn ID */}
      <div style={{ padding: '8px 10px 4px', fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
        {image.spawn_id}
      </div>

      {/* Tag buttons */}
      <div style={{ padding: '4px 10px 10px', display: 'flex', gap: 6 }}>
        {TAG_OPTIONS.map(opt => {
          const isActive  = currentTag === opt.value;
          const isLoading = saving === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => void handleTag(opt.value)}
              disabled={!!saving}
              style={{
                flex: 1,
                padding: '6px 4px',
                borderRadius: 7,
                border: `1px solid ${isActive ? opt.color : 'var(--border)'}`,
                background: isActive ? opt.dim : 'transparent',
                color: isActive ? opt.color : 'var(--muted)',
                fontSize: 11,
                fontWeight: isActive ? 700 : 400,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving && !isLoading ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              {isLoading ? '…' : opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Upload zone ───────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: (img: SorterImage) => void }) {
  const [dragging,    setDragging]    = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setUploadError('Only image files are supported.');
      return;
    }
    setUploading(true);
    setUploadError(null);

    const spawnId     = generateUploadId();
    const storagePath = `cards/${spawnId}.jpg`;

    const arrayBuf = await file.arrayBuffer();
    const buffer   = new Uint8Array(arrayBuf);

    // Upload to storage
    const { error: uploadErr } = await supabase.storage
      .from('card-images')
      .upload(storagePath, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) {
      setUploadError(`Upload failed: ${uploadErr.message}`);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('card-images').getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // Insert into card_images
    const { data, error: insertErr } = await supabase
      .from('card_images')
      .insert({
        spawn_id:     spawnId,
        storage_path: storagePath,
        public_url:   publicUrl,
        raw_caption:  file.name,
        detected_at:  new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      setUploadError(`DB insert failed: ${insertErr.message}`);
      setUploading(false);
      return;
    }

    onUploaded(data as SorterImage);
    setUploading(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) void processFile(f);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) void processFile(f);
    e.target.value = '';
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? 'var(--blue)' : 'var(--border2)'}`,
        borderRadius: 10,
        padding: '28px 20px',
        textAlign: 'center',
        cursor: uploading ? 'not-allowed' : 'pointer',
        background: dragging ? 'var(--blue-dim)' : 'transparent',
        transition: 'all 0.15s',
        marginBottom: 24,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
      <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.5 }}>⬆</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: uploading ? 'var(--muted)' : 'var(--text)' }}>
        {uploading ? 'Uploading…' : 'Drop images here or click to upload'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        PNG, JPG, WEBP — multiple files supported
      </div>
      {uploadError && (
        <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{uploadError}</div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

type TagFilter = 'all' | 'new design' | 'old design' | 'untagged';

export default function SorterPage() {
  const [images,  setImages]  = useState<SorterImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<TagFilter>('all');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('card_images')
        .select('id, created_at, spawn_id, public_url, design_tag, raw_caption')
        .order('created_at', { ascending: false })
        .limit(500);
      if (data) setImages(data as SorterImage[]);
      setLoading(false);
    })();
  }, []);

  const handleTag = useCallback(async (id: string, spawnId: string, tag: DesignTag) => {
    const { error } = await supabase
      .from('card_images')
      .update({ design_tag: tag })
      .eq('id', id);

    if (error) {
      console.error('[SORTER] tag failed:', error.message);
      return;
    }

    // Also call the shared tag API so imager.tagDesign is consistent
    void fetch(`/api/images/${encodeURIComponent(spawnId)}/tag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designTag: tag }),
    });

    setImages(prev => prev.map(img => img.id === id ? { ...img, design_tag: tag } : img));
  }, []);

  const handleUploaded = useCallback((img: SorterImage) => {
    setImages(prev => [img, ...prev]);
  }, []);

  const displayed = images.filter(img => {
    if (filter === 'untagged')    return !img.design_tag;
    if (filter === 'new design')  return img.design_tag === 'new design';
    if (filter === 'old design')  return img.design_tag === 'old design';
    return true;
  });

  const counts = {
    all:          images.length,
    'new design': images.filter(i => i.design_tag === 'new design').length,
    'old design': images.filter(i => i.design_tag === 'old design').length,
    untagged:     images.filter(i => !i.design_tag).length,
  };

  const FILTERS: { value: TagFilter; label: string }[] = [
    { value: 'all',        label: `All (${counts.all})` },
    { value: 'untagged',   label: `Untagged (${counts.untagged})` },
    { value: 'new design', label: `✦ New (${counts['new design']})` },
    { value: 'old design', label: `◈ Old (${counts['old design']})` },
  ];

  return (
    <div className="fade-up">

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>
          Sorter
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Tag card designs as New or Old. Upload reference images directly.
        </p>
      </div>

      {/* Upload zone */}
      <UploadZone onUploaded={handleUploaded} />

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              padding: '6px 13px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', border: 'none', transition: 'all 0.15s',
              background: filter === f.value ? 'var(--blue)' : 'var(--surface2)',
              color: filter === f.value ? '#fff' : 'var(--muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 14,
        }}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 280, borderRadius: 10 }} />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>
          {images.length === 0
            ? 'No images yet — upload one above or wait for a card spawn.'
            : 'No images match this filter.'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 14,
        }}>
          {displayed.map(img => (
            <SorterCard key={img.id} image={img} onTag={handleTag} />
          ))}
        </div>
      )}
    </div>
  );
}
