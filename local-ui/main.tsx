import React from 'react';
import{createRoot}from'react-dom/client';
import Dashboard from '../app/ui/dashboard';
import Menu from '../app/ui/menu';
import '../app/globals.css';
import '../app/product.css';
const path=location.pathname;createRoot(document.getElementById('root')!).render(path==='/menu'||path==='/portal'?<Menu/>:path==='/demo'?<Menu demo/>:path==='/preview'?<Menu preview/>:<Dashboard/>);
