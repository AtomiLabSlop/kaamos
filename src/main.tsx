import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@react-spectrum/s2/page.css';
import '@fontsource-variable/source-sans-3';
import './index.css';
import { Provider } from '@react-spectrum/s2';
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
    {/* Spectrum 2 needs one Provider at the root: dark scheme, no background
        of its own (the app paints its shell), English locale. */}
    <Provider colorScheme="dark" locale="en-US" UNSAFE_style={{ height: '100%' }}>
      <App />
    </Provider>
  </StrictMode>,
);
