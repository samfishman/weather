import { render } from 'preact';
import { App } from './App';
import './styles.css';

// Design previews: ?theme=<name> layers src/client/themes/<name>.css over the base styles.
const themes = import.meta.glob('./themes/*.css');
const theme = new URLSearchParams(location.search).get('theme');
const loadTheme = theme ? themes[`./themes/${theme}.css`] : undefined;

(loadTheme ? loadTheme() : Promise.resolve()).finally(() => render(<App />, document.getElementById('app')!));
