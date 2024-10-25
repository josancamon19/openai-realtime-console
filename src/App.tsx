import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ConsolePage } from './pages/ConsolePage';

function App() {
  return (
    <Router>
      <div data-component="App">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/study" element={<ConsolePage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
