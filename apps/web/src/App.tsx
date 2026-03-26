import { MapSurface } from "./surfaces/MapSurface.js";
import { ChatInterface } from "./components/chat/ChatInterface.js";

export function App() {
  return (
    <div style={styles.layout}>
      <div style={styles.map}>
        <MapSurface />
      </div>
      <div style={styles.chat}>
        <ChatInterface />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
  },
  map: {
    flex: 1,
    position: "relative",
  },
  chat: {
    width: 360,
    flexShrink: 0,
  },
};
