import { injectStyles } from './styles';
import { initInjector } from './injector';

// Self-bootstrap: runs immediately when loaded as <script type="module">
injectStyles();
initInjector();
