import{ Routes, Route} from "react-router-dom";

import MainPage from "./pages/MainPage";
import BookDetailPage from "./pages/BookDetailPage";

function App(){
  return (
    <Routes>
      <Route
        path="/"
        element={<MainPage />}
      />
      <Route
        path="/books/new"
        element={<BookDetailPage />}
      />
      <Route
        path="/books/:id"
        element={<BookDetailPage />}
      />
    </Routes>

  );
}

export default App;