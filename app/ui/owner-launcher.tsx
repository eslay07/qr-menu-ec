"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, Smartphone, Store } from "lucide-react";

export default function OwnerLauncher() {
  const [code, setCode] = useState(
      () => localStorage.getItem("qrmenu_restaurant_code") || "",
    ),
    [error, setError] = useState("");
  function open(event: FormEvent) {
    event.preventDefault();
    const value = code.trim().toLowerCase();
    if (!/^[a-f0-9-]{36}$/.test(value)) {
      setError("Escribe el código completo que te entregó el creador.");
      return;
    }
    localStorage.setItem("qrmenu_restaurant_code", value);
    location.href = `/r/${value}/`;
  }
  return (
    <main className="creator-auth">
      <section className="creator-login card">
        <Smartphone size={42} />
        <p className="eyebrow">APP DEL DUEÑO</p>
        <h1>Administrar mi restaurante</h1>
        <p>
          Escribe una vez el código que te entregó el creador. Luego iniciarás
          sesión con tu contraseña.
        </p>
        {error && <div className="notice error">{error}</div>}
        <form onSubmit={open}>
          <label>
            Código del restaurante
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <button className="btn primary" type="submit">
            <Store size={17} />
            Continuar <ArrowRight size={16} />
          </button>
        </form>
        <small className="muted">
          El creador controla si tu acceso está habilitado y qué funciones
          puedes usar.
        </small>
      </section>
    </main>
  );
}
