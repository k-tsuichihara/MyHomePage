import { useNavigate } from "react-router-dom";

// 本情報表示用タイプ
type BookSpineProps = {
    id : string;
    title  : string;
    author : string;
    rating : number | null;
    backgroundColor : string | null;
};

function BookSpine({
    id,
    title,
    author,
    rating,
    backgroundColor,
} : BookSpineProps){
    
    const navigate = useNavigate();

    // 文字の色、一部線の色を指定
    const lightBackgrounds = [
        "#E07A5F",
        "#81B29A",
        "#9A7B56",
    ];

    const textColor = lightBackgrounds.includes(backgroundColor ?? "")
        ? "#000000"
        : "#FFFFFF";

    return(
        <article 
            className="book-spine"
            style={{ backgroundColor: backgroundColor ?? "#E8E8E8", color: backgroundColor === null ? "#000000" : textColor,}}
            onClick={() => navigate(`/books/${id}`)}
        >
            <div className="book-title">
                {title.length > 12
                    ? `${title.slice(0, 12)}…`
                    : title}
            </div>
            <div className="book-author">
                {author}
            </div>
            <div className="book-rating" style={{borderTop: `1px solid ${backgroundColor === null ? "#000000" : textColor}`}}>
                {rating !== null ? (
                    <>
                        <span className="rating-star">★</span>
                        <span className="rating-number">{rating}</span>                    
                    </>
                ) : (
                    <span className="rating-none">-</span>
                )}

            </div>
        </article>
    );
}

export default BookSpine;