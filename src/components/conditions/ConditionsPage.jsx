import React from 'react';
import ConditionsTable from './ConditionsTable';

export default class ItemsPage extends React.Component {
    render() {
        return ( 
            <div>
                <h2>Positive</h2>
                <ConditionsTable data = { this.props.data.filter((e)=>e.isPositive)} />
                <h2>Negative</h2>
                <ConditionsTable data = { this.props.data.filter((e)=>!e.isPositive)} />
            </div> 
        );
    }
}
