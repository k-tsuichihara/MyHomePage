import type { BookSearchResult } from "../types/BookSearchResult";

export async function searchBooksByTitle(
    title : string
) : Promise<BookSearchResult[]>{
    
    const query = encodeURIComponent(`intitle:${title}`);
    const apiKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
    const response = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=10&langRestrict=ja&key=${apiKey}`
    );


    if(!response.ok){
        console.error("Google Books API error:", response.status);
        throw new Error("書籍情報の取得に失敗しました。");
    }

    const data = await response.json();
    console.log("Google Books raw:", data);
    console.log("volumeInfo:", data.items?.[0]?.volumeInfo);

    if(!data.items){
        return [];
    }

    return data.items.map((item: any) => {

        const volumeInfo = item.volumeInfo;
        const isbn = 
            volumeInfo.industryIdentifiers?.find(
                (identifier: any) =>
                    identifier.type === "ISBN_13"
            )?.identifier ??
            volumeInfo.industryIdentifiers?.find(
                (identifier: any) =>
                    identifier.type === "ISBN_10"
            )?.identifier ??
            null;
        
        return{
            googleBooksId: item.id,
            title: volumeInfo.title ?? "",
            author: volumeInfo.authors?.join(",") ?? "",
            isbn,
            cover_url:
                (
                    volumeInfo.imageLinks?.thumbnail ??
                    volumeInfo.imageLinks?.smallThumbnail ??
                    null
                )?.replace("http://", "https://") ?? null,
        };

    });
}

export async function searchBooksByIsbn(
    isbn: string
): Promise<BookSearchResult[]>{

    const query = encodeURIComponent(`isbn:${isbn}`);
    const apiKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;

    const response = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=10&langRestrict=ja&key=${apiKey}`
    );

    if(!response.ok){
        console.error("Google Books API error:", response.status);
        throw new Error("書籍情報の取得に失敗しました。");
    }

    const data = await response.json();

    if(!data.items){
        return [];
    }

    return data.items.map((item: any) => {
        const volumeInfo = item.volumeInfo;

        return {
            googleBooksId: item.id,
            title: volumeInfo.title ?? "",
            author: volumeInfo.authors?.join(", ") ?? "",
            
            // ISBNの検索の場合は、バーコードから取得したISBNを採用（表示されないケースがある）
            isbn: isbn,

            cover_url:
                (
                    volumeInfo.imageLinks?.thumbnail ??
                    volumeInfo.imageLinks?.smallThubnail ??
                    null
                )?.replace("http://", "https://") ?? null,
        };
    });
}