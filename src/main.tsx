import './index.css';
import { mountApplication } from './bootstrap/entry';

const root = document.getElementById('root');
if (!root) {
  throw new Error('未找到应用挂载节点 #root');
}

await mountApplication(root, window.host);
