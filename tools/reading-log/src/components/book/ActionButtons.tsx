import "./ActionButtons.css";
import "../../index.css";
import { useNavigate } from "react-router-dom";

type ActionButtonProps = {
    isNew : boolean;
    isLoggedIn : boolean;
    onAdd: () => void;
    onUpdate: () => void;
    onDelete: () => void;
}

function ActionButtons({
    isNew,
    isLoggedIn,
    onAdd,
    onUpdate,
    onDelete,
}: ActionButtonProps){

    const navigate = useNavigate();

    return(
        <div className="action-button-area">
            <div className="action-left">
                <button 
                type="button" 
                className="common-button action-button"
                onClick={() => navigate("/")}
                >
                    一覧へ
                </button>
            </div>
            <div className="action-right">
                {isLoggedIn && (
                    <button 
                        type="button" 
                        className="common-button action-button"
                        onClick={isNew ? onAdd : onUpdate}
                    >
                        {isNew ? "追加" : "更新"}
                    </button>
                )}
                {isLoggedIn && !isNew && (
                    <button type="button" className="common-button action-button" onClick={onDelete}>
                        削除
                    </button>
                )}
            </div>
        </div>
    );
}

export default ActionButtons;