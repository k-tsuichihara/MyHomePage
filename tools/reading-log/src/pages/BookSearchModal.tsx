import { useRef, useState} from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { BookSearchResult } from "../types/BookSearchResult";
import { searchBooksByIsbn, searchBooksByTitle} from "../services/bookSearchService";
import "./BookSearchModal.css";

type BookSearchModalProps = {
    onSelect: (book: BookSearchResult) => void;
    onClearCover: () => void;
    onClose: () => void;
    hasCover: boolean;
};

function BookSearchModal({
    onSelect,
    onClearCover,
    onClose,
    hasCover
}: BookSearchModalProps){

    const[ keyword, setKeyword ] = useState("");
    const[ results, setResults ] = useState<BookSearchResult[]>([]);
    const[ isLoading, setIsLoading ] = useState(false);
    const[ errorMessage, setErrorMessage ] = useState("");
    const[ isCameraOpen, setIsCameraOpen ] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const controlRef = useRef<{ stop: () => void} | null>(null);
    
    const handleSearch = async() => {
        const trimmedKeyword = keyword.trim();

        if (trimmedKeyword === ""){
            return;
        }

        setIsLoading(true);
        setErrorMessage("");

        try{
            const books = await searchBooksByTitle(trimmedKeyword);
            setResults(books);
        } catch{
            setResults([]);
            setErrorMessage("本の検索に失敗しました。");
        } finally{
            setIsLoading(false);
        }

    };

    const handleCloseModal = () => {
        controlRef.current?.stop();
        controlRef.current = null;

        const stream = videoRef.current?.srcObject as MediaStream | null;

        if(stream){
            stream.getTracks().forEach((track) => {
                track.stop();
            });
        }

        if(videoRef.current){
            videoRef.current.srcObject = null;
        }

        setIsCameraOpen(false);
    };
    const handleOpenCamera = async () => {
        setIsCameraOpen(true);
        setErrorMessage("");

        try {
            const codeReader = new BrowserMultiFormatReader();

            // video要素が画面に作られるのを待つ
            setTimeout(async () => {
                if (!videoRef.current) {
                    return;
                }

                try {
                    const controls =
                        await codeReader.decodeFromConstraints(
                            {
                                video: {
                                    facingMode: {
                                        ideal: "environment"
                                    }
                                }
                            },
                            videoRef.current,
                            (result) => {
                                if(!result){
                                    return;
                                }

                                const barcode = result.getText();
                                // ISBN-13だけ採用
                                if (!/^(978|979)\d{10}$/.test(barcode)) {
                                    return;
                                }
                                // 読み取り成功でカメラ停止
                                handleCloseModal();

                                // GoogleBooksで検索
                                setIsLoading(true);
                                setErrorMessage("");

                                searchBooksByIsbn(barcode)
                                    .then((books) => {
                                        setResults(books);

                                        if(books.length === 0){
                                            setErrorMessage(
                                                "このISBNに該当する本が見つかりませんでした。"
                                            );
                                        }
                                    })
                                    .catch((error) => {
                                        console.error("ISBN検索エラー:",error);
                                        setResults([]);
                                        setErrorMessage("本の検索に失敗しました。");
                                    })
                                    .finally(() => {
                                        setIsLoading(false);
                                    });
                            }
                        );

                    controlRef.current = controls;

                } catch (error) {
                    console.error("カメラ起動エラー:", error);
                    setErrorMessage("カメラを起動できませんでした。");
                    setIsCameraOpen(false);
                }
            }, 100);

        } catch (error) {
            console.error("バーコードリーダー初期化エラー:", error);
            setErrorMessage("バーコード読み取りを開始できませんでした。");
            setIsCameraOpen(false);
        }
    };

    return(
        <div className="book-search-modal">
            <div className="book-search-modal-content">
                <div className="book-search-modal-header">
                    <h2>本を検索</h2>
                    <div className="book-search-modal-actions">
                        {hasCover && (
                            <button
                                type="button"
                                className="book-cover-clear-button"
                                onClick={() => {
                                    onClearCover();
                                    onClose();
                                }}
                            >表紙をクリア</button>
                        )}
                    </div>
                    <button
                        type="button"
                        className="book-search-close-button"
                        onClick={onClose}
                    >×</button>
                </div>
                <div className="book-search-area">
                    <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="タイトルを入力"
                    />
                    <button
                        type="button"
                        onClick={handleSearch}
                    >検索</button>
                    <button
                        type="button"
                        className="barcode-camera-button"
                        onClick={handleOpenCamera}
                    > 📷</button>
                    {isCameraOpen && (
                        <div className="barcode-camera-area">
                            <video
                                ref={videoRef}
                                style={{
                                    width:"100%",
                                    maxWidth:"400px"
                                }}
                            />
                            <button
                                type="button"
                                onClick={handleCloseModal}
                            >×</button>
                        </div>
                    )}
                    {isLoading && (
                        <div>検索中...</div>
                    )}
                    {errorMessage !== "" && (
                        <div>{errorMessage}</div>
                    )}
                    <div className="book-search-results">
                        {results.map((result) => (
                            <button
                                type="button"
                                key={result.googleBooksId}
                                className="book-search-result"
                                onClick={() => onSelect(result)}
                            >
                                <div className="book-search-result-cover">
                                    {result.cover_url ? (
                                        <img
                                            src={result.cover_url}
                                            alt={result.title}
                                        />
                                    ) : (
                                        <span>NO IMAGE</span>
                                    )}
                                </div>
                                <div className="book-search-result-info">
                                    <div>{result.title}</div>
                                    <div>{result.author}</div>
                                    {result.isbn && (
                                        <div>ISBN:{result.isbn}</div>
                                    )}
                                </div>
                            </button>

                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default BookSearchModal;