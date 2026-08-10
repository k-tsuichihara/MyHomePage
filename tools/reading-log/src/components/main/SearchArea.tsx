import SearchInput from "./SearchInput";
import FilterControls from "./FilterControls";
import "./SearchArea.css";

type SearchAreaProps = {
    keyword : string;
    onKeywordChange : (value: string) => void;
    rating : string;
    onRatingChange: (value: string) => void;
    sortOrder : string;
    onSortOrderChange: (value: string) => void;
    startDate : string;
    onStartDateChange: (value: string) => void;
    endDate : string;
    onEndDateChange: (value: string) => void;
    onClear: () => void;
};
function SearchArea({
    keyword,
    onKeywordChange,
    rating,
    onRatingChange,
    sortOrder,
    onSortOrderChange,
    startDate,
    onStartDateChange,
    endDate,
    onEndDateChange,
    onClear

} : SearchAreaProps) {
    return(
        <>
            <div className ="inside-padding search-area">
                <SearchInput 
                    keyword={keyword}
                    onKeywordChange={onKeywordChange}
                />
                <FilterControls 
                    rating={rating}
                    onRatingChange={onRatingChange}

                    sortOrder={sortOrder}
                    onSortOrderChange={onSortOrderChange}

                    startDate={startDate}
                    onStartDateChange={onStartDateChange}

                    endDate={endDate}
                    onEndDateChange={onEndDateChange}

                    onClear={onClear}
                />
            </div>
            <div className ="section-partition" />
        </>
    );
}

export default SearchArea;