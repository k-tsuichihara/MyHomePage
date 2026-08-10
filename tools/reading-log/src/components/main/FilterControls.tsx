type FilterControlsProps = {
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

function FilterControls({
    rating,
    onRatingChange,
    sortOrder,
    onSortOrderChange,
    startDate,
    onStartDateChange,
    endDate,
    onEndDateChange,
    onClear,
}: FilterControlsProps) {

    return(
        <div className="inside-padding filter-area">
            <select 
                className="rating-filter"
                value={rating}
                onChange={(event) => onRatingChange(event.target.value)}
            >
                <option value="">評価</option>
                <option value="5">★5</option>
                <option value="4">★4</option>
                <option value="3">★3</option>
                <option value="2">★2</option>
                <option value="1">★1</option>
                <option value="none">評価なし</option>
            </select>
            <select 
                className="sort-select" 
                value={sortOrder}
                onChange={(event) => onSortOrderChange(event.target.value)}
            >
                <option value="">並び替え</option>
                <option value="read_date_desc">読了日（新しい順）</option>
                <option value="read_date_asc">読了日（古い順）</option>
                <option value="rating_desc">評価（高い順）</option>
                <option value="rating_asc">評価（低い順）</option>
                <option value="author_asc">著者名順</option>
            </select>
            <div className="date-filter">
                <input
                    className="read-date-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => onStartDateChange(event.target.value)}
                />
                <span>～</span>
                <input
                    className="read-date-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => onEndDateChange(event.target.value)}
                />
            </div>
            <button
              className="common-button clear-button"
              type="button"
              onClick={onClear}
            >
                クリア
            </button>

        </div>

    );
}

export default FilterControls;