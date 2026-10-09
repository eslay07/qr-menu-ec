import { useId, useRef, useState } from 'react';
import { ImagePlus, Upload, Trash2 } from 'lucide-react';
import { restaurantBase, uploadPhoto } from './client';

export default function PhotoPicker({ value, onChange, onBusy }: {
  value: string; onChange: (url: string) => void; onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = value.startsWith('/api/v1/media/') ? restaurantBase() + value : value;
  return <section className="dish-photo-editor" aria-busy={busy}>
    <div className="photo-preview">{url ? <picture><img src={url} alt="Vista previa de la foto del plato" /></picture> : <ImagePlus size={36} />}</div>
    <div><h3>Foto del plato</h3><p>Una buena foto ayuda a elegir. JPG, PNG o WebP; la optimizamos al subirla.</p>
      <input ref={input} id={id} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={busy}
        aria-label="Subir foto del plato" onChange={async e => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setBusy(true); onBusy(true); setError('');
          try { onChange(await uploadPhoto(file)); }
          catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); onBusy(false); }
        }} />
      <div className="photo-actions"><button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><Upload size={17} />{busy ? 'Subiendo foto…' : value ? 'Cambiar foto' : 'Subir foto'}</button>
        {value && <button type="button" className="btn" disabled={busy} onClick={() => onChange('')}><Trash2 size={16} />Quitar</button>}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {busy && <output >Preparando la imagen, espera un momento.</output>}
    </div>
  </section>;
}
