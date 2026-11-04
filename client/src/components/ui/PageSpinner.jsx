import Spinner from './Spinner';

// The loading spinner in the middle of a page
export default function PageSpinner() {
  return (
    <div className="flex justify-center py-12">
      <Spinner size={28} />
    </div>
  );
}
