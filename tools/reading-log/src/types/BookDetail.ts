export type BookDetail = {
    id             : string;
    isbn           : string;
    title          : string;
    author         : string;
    category_id    : number | null;
    status         : string;
    read_date      : string | null;
    rating         : number | null;
    memo           : string | null;
    impression     : string | null;
    cover_url      : string | null;
    created_at     : string | null;
    updated_at     : string | null;
    category_name  : string | null;
    category_color  : string | null;
}