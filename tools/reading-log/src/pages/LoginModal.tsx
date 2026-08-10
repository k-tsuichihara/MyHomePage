import "./LoginModal.css";
import { login } from "../services/authService";
import { useState} from "react";

type LoginModalProps = {
    onClose: () => void;
};

function LoginModal({ onClose }: LoginModalProps){

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const handleLogin = async () => {
        const {error} = await login(email, password);

        // ログイン判定
        if(error){
            alert(error.message);
            return;
        }

        onClose();
    };



    return(
        <div className="modal-overlay">
            <div className="login-modal">
                <button 
                    type="button"
                    className="modal-close-button"
                    onClick={onClose}
                >×</button>
                <h2>ログイン</h2>
                <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="メールアドレス"
                />
                <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="パスワード"
                />
                <button type="button" onClick={handleLogin}>OK</button>
            </div>
        </div>
    );
}

export default LoginModal;