import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
const Dashboard = lazy(() => import('../app/ui/dashboard'));
const Menu = lazy(() => import('../app/ui/menu'));
const CreatorDashboard = lazy(() => import('../app/ui/creator-dashboard'));
const OwnerLauncher = lazy(() => import('../app/ui/owner-launcher'));
const OrderView = lazy(() => import('../app/ui/order-view'));
import '../app/globals.css';
import '../app/product.css';
import '../app/creator.css';
import '../app/experience.css';

const path = location.pathname;
const restaurant = path.match(/^\/r\/[a-f0-9-]{36}(\/.*)?$/);
const readable = path.match(/^\/m\/[a-z0-9]+(?:-[a-z0-9]+)*(\/.*)?$/);
const sub = restaurant?.[1] || readable?.[1] || '/';

createRoot(document.getElementById('root')!).render(<Suspense fallback={<main className="menu-shell" aria-busy="true" aria-label="Cargando"><output>Cargando…</output></main>}>
  {path === '/creator' ? (
    <CreatorDashboard />
  ) : path === '/owner' ? (
    <OwnerLauncher />
  ) : sub === '/menu' || path === '/menu' || (Boolean(readable) && sub === '/') ? (
    <Menu />
  ) : sub.startsWith('/order/') || path.startsWith('/order/') ? (
    <OrderView />
  ) : path === '/demo' ? (
    <Menu demo />
  ) : sub === '/preview' || path === '/preview' ? (
    <Menu preview />
  ) : (
    <Dashboard />
  )}</Suspense>,
);
