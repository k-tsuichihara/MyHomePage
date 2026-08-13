import { useNavigate } from "react-router-dom";

import "./FooterMenu.css";

type FooterMenuProps = {
    shelfMode: "read" | "wishlist";
    onShelfModeChange: (mode:"read" | "wishlist") => void;
    viewMode: "spine" | "cover";
    onViewModeChange:(mode: "spine" | "cover") => void;
    isLoggedIn: boolean;
};

function FooterMenu({
  shelfMode,
  onShelfModeChange,
  viewMode,
  onViewModeChange,
  isLoggedIn
} :FooterMenuProps) {
    
    const navigate = useNavigate();
    const handleRegisterClick = () => {
      if(!isLoggedIn){
        alert("本を登録するにはログインしてください");
        return;
      }
      navigate("/books/new");
    }
    const handleShelfModeChange = () => {
      if (shelfMode === "read"){
        onShelfModeChange("wishlist");
      } else {
        onShelfModeChange("read");
      }
    }
    const handleViewModeChange = () => {
      if(viewMode === "spine"){
        onViewModeChange("cover");
      } else{
        onViewModeChange("spine");
      }
    }

    return(
      <div className="footer">
        <div className="section-partition" />
        <div className="button-area">
          <button 
            className="common-button register-button"
            onClick={handleRegisterClick}
          >
            + 本を登録
          </button>
          <button
            className="common-button view-mode-button"
            type="button"
            onClick={handleViewModeChange}
          >
            {
              viewMode === "spine"
                ? "本棚形式"
                : "カバー一覧"
            }
          </button>
          <button className="common-button wishlist-button" type="button" onClick={handleShelfModeChange}>
            {
              shelfMode === "read"
                ? "読みたい本"
                : "読んだ本"
            }
          </button>
        </div>
      </div>
    );
}

export default FooterMenu;