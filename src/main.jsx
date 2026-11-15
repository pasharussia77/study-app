import React from 'react';
import './theme.js';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Worn from './Worn.jsx';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

createRoot(document.getElementById('root')).render(<><App /><Worn /></>);

if ('serviceWorker' in navigator && !location.search.includes('mock')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
