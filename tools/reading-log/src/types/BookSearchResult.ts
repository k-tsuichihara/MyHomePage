export type BookSearchResult = {
    googleBooksId : string;
    title : string;
    author : string;
    isbn : string | null;
    cover_url : string | null;
}