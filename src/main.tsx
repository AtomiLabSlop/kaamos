import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useProject } from './store/project';
import { useUI } from './store/ui';
import * as actions from './actions';

const host = document.getElementById('root');
if (!host) throw new Error('Root element missing from index.html');

// Development builds only: lets the UI walkthrough script read the stores, so it
// can tell whether a control actually changed anything. Not in production.
if (import.meta.env.DEV) {
  Object.assign(window, { __kaamos: { useProject, useUI, actions } });
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
