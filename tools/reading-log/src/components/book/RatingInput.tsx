import { useState } from "react";

type RatingInputProps = {
    value: number | null;
    onChange: (rating: number) => void;
    disabled? : boolean;
}

// 星部分
function RatingInput({ value, onChange, disabled = false}: RatingInputProps){
    const [hoverRating, setHoverRating] = useState<number | null>(null);

    return(
        <div className="rating-input">
            {[1, 2, 3, 4, 5].map((star) => {
                const displayRating = 
                    disabled
                    ? value ?? 0
                    : hoverRating ?? value?? 0;
                const isActive = star <= displayRating;

                return(
                    <button
                        key={star}
                        type="button"
                        className={`rating-star ${isActive ? "active" : ""}`}
                        disabled={disabled}
                        onMouseEnter={() => {
                            if(!disabled){
                                setHoverRating(star);
                            }
                        }}
                        onMouseLeave={() => {
                            if(!disabled){
                                setHoverRating(null);
                            }
                        }}
                        onClick={() => {
                            if(!disabled){
                                onChange(star);
                            }
                        }}
                    >
                        {isActive ? "★" : "☆"}
                    </button>
                );

            })}
        </div>
    );
}

export default RatingInput;