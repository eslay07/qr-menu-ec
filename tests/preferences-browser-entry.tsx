import React from 'react';
import { createRoot } from 'react-dom/client';
import Panel from '../app/ui/restaurant-preferences';

const mode = new URLSearchParams(location.search).get('mode') === 'wifi' ? 'wifi' : 'notifications';
createRoot(document.getElementById('root')!).render(<Panel mode={mode} />);
