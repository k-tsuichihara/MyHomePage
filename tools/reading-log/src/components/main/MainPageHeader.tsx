import "./MainPageHeader.css";

type MainPageHeaderProps = {
    bookCount : number;
    isLoggedIn: boolean;
    onLoginClick: () => void;
    onLogoutClick: () => void;
};

function MainPageHeader({ bookCount, isLoggedIn, onLoginClick, onLogoutClick } :MainPageHeaderProps) {
    return(
        <div className="inside-padding main-header">
            <div className="title-group">
                <div className="header-name">
                    本棚
                </div>
                <div className="book-count">
                    {bookCount}冊
                </div>
            </div>
            <div className="login-area">
                <button 
                    className="common-button login-button"
                    onClick={isLoggedIn
                        ? onLogoutClick
                        : onLoginClick
                    }
                >
                    {isLoggedIn
                        ? "ログアウト"
                        : "ログイン"
                    }
                </button>
            </div>
        </div>
    );
}

export default MainPageHeader;