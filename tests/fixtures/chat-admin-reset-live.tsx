import {createRoot} from 'react-dom/client';
import AdminChatReset from '../../app/admin-chat-reset';
import ChatDock from '../../app/chat-dock';
createRoot(document.getElementById('root')!).render((window as any).qaRole==='admin'?<AdminChatReset publicId={'a'.repeat(16)} name="QA member"/>:<ChatDock/>);
