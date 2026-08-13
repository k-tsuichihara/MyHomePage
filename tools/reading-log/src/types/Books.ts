export type Book = {
    id             : string;
    title          : string;
    author         : string;
    category_id    : string | null;
    status         : string;
    read_date      : string | null;
    rating         : number | null;
    category_name  : string | null;
    category_color  : string | null;
    cover_url      : string | null;
}