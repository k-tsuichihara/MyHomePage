import "./TextEditModal.css";

type TextEditModalProps = {
    title : string;
    value : string;
    onChange: (value: string) => void;
    onClose: () => void;
};

function TextEditModal({
    title,
    value,
    onChange,
    onClose,
}: TextEditModalProps){
    return(
        <div className="text-modal-overlay">
            <div className="text-edit-modal">
                <div className="text-modal-header">
                    <h2>{title}</h2>
                    <button
                        type="button"
                        className="text-modal-close"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </div>
                <textarea
                    className="text-modal-input"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                <div className="text-modal-footer">
                    <button
                        type="button"
                        onClick={onClose}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TextEditModal;