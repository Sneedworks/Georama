import { render } from 'preact';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing renderer root');
render(<App />, root);
