import type { Metadata } from 'next';
import './globals.css';
import './product.css';
export const metadata: Metadata = { title: 'QR Menú · Panel del restaurante', description: 'Gestiona tu carta, publica tu menú y configura el acceso de tus clientes.', manifest: '/manifest.webmanifest' };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) { return <html lang="es"><body>{children}</body></html>; }
